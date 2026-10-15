import { isRecord, numberField, parseJson } from "../guards.ts";
import type { ProviderSnapshot, Window } from "../types.ts";

const CLAUDE_KEYCHAIN_SERVICE = "Claude Code-credentials";
const CLAUDE_REFRESH_SKEW_MS = 5 * 60 * 1000;
const CLAUDE_CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const CLAUDE_SCOPES =
  "user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload";

export type ClaudeCredentials = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  source: string;
};

type ClaudeUsageWindow = { utilization?: number; resets_at?: string };

export type ClaudeUsage = Record<string, ClaudeUsageWindow | undefined>;

function parseCredentials(document: string, source: string): ClaudeCredentials | undefined {
  const parsed = parseJson(document);
  if (!isRecord(parsed)) return undefined;
  const oauth = parsed.claudeAiOauth;
  if (!isRecord(oauth)) return undefined;
  const accessToken = oauth.accessToken;
  const refreshToken = oauth.refreshToken;
  if (typeof accessToken !== "string" || accessToken.length === 0) return undefined;
  return {
    accessToken,
    refreshToken: typeof refreshToken === "string" ? refreshToken : "",
    expiresAt: numberField(oauth, "expiresAt") ?? 0,
    source,
  };
}

async function keychainCredentials(): Promise<ClaudeCredentials | undefined> {
  if (process.platform !== "darwin") return undefined;
  const homedir = process.env.CLAUDE_CONFIG_DIR;
  const services = [CLAUDE_KEYCHAIN_SERVICE];
  if (homedir) {
    const hash = new Bun.CryptoHasher("sha256").update(homedir).digest("hex").slice(0, 8);
    services.unshift(`${CLAUDE_KEYCHAIN_SERVICE}-${hash}`);
  }
  // Claude Code stores its login under the OS username. Other entries with the same service name
  // (e.g. an empty one left behind with account "unknown") must not shadow it, so ask for that
  // account first and only then fall back to whichever entry the keychain returns.
  const accounts = [process.env.USER, undefined];
  for (const service of services) {
    for (const account of accounts) {
      const result = Bun.spawnSync({
        cmd: ["security", "find-generic-password", "-s", service, ...(account ? ["-a", account] : []), "-w"],
        stdout: "pipe",
        stderr: "ignore",
      });
      if (result.exitCode !== 0) continue;
      const credentials = parseCredentials(result.stdout.toString().trim(), `keychain:${service}`);
      if (credentials) return credentials;
    }
  }
  return undefined;
}

export async function loadClaudeCredentials(): Promise<ClaudeCredentials> {
  const fromKeychain = await keychainCredentials();
  if (fromKeychain) return fromKeychain;

  const configDir = process.env.CLAUDE_CONFIG_DIR ?? `${process.env.HOME}/.claude`;
  const path = `${configDir}/.credentials.json`;
  const file = Bun.file(path);
  if (!(await file.exists())) {
    throw new Error(`no usable Claude Code credentials (keychain entry empty or ${path} missing); log in with \`claude\``);
  }
  const credentials = parseCredentials(await file.text(), `file:${path}`);
  if (!credentials) throw new Error(`unrecognized credential shape in ${path}`);
  return credentials;
}

async function refresh(credentials: ClaudeCredentials): Promise<ClaudeCredentials> {
  const response = await fetch("https://platform.claude.com/v1/oauth/token", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      grant_type: "refresh_token",
      refresh_token: credentials.refreshToken,
      client_id: CLAUDE_CLIENT_ID,
      scope: CLAUDE_SCOPES,
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) {
    throw new Error(`oauth refresh failed: ${response.status} ${await response.text()}`);
  }
  const payload = (await response.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };
  if (typeof payload.access_token !== "string") {
    throw new Error("oauth refresh returned no access_token");
  }
  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token ?? credentials.refreshToken,
    expiresAt: Date.now() + (payload.expires_in ?? 3600) * 1000,
    source: credentials.source,
  };
}

async function requestUsage(credentials: ClaudeCredentials): Promise<ClaudeUsage> {
  const response = await fetch("https://api.anthropic.com/api/oauth/usage", {
    headers: {
      authorization: `Bearer ${credentials.accessToken}`,
      accept: "application/json",
      "content-type": "application/json",
      "anthropic-beta": "oauth-2025-04-20",
    },
    signal: AbortSignal.timeout(15000),
  });
  if (response.status === 401 || response.status === 403) {
    throw new Error(`unauthorized (${response.status})`);
  }
  if (!response.ok) throw new Error(`usage request failed: ${response.status}`);
  const payload: unknown = await response.json();
  if (!isRecord(payload)) throw new Error("usage response was not an object");
  return payload as ClaudeUsage;
}

const WINDOW_LABELS: Array<[key: string, label: string]> = [
  ["five_hour", "5h"],
  ["seven_day", "wk"],
  ["seven_day_opus", "opus"],
  ["seven_day_omelette", "design"],
  ["seven_day_oauth_apps", "apps"],
];

const MAX_WINDOWS = 4;

export function windowsFromClaudeUsage(usage: ClaudeUsage): Window[] {
  const windows: Window[] = [];
  for (const [key, label] of WINDOW_LABELS) {
    const window = usage[key];
    if (!window || typeof window.utilization !== "number") continue;
    const resetsAt = typeof window.resets_at === "string" ? new Date(window.resets_at) : undefined;
    windows.push({
      label,
      usedPercent: Math.max(0, Math.min(100, window.utilization)),
      resetsAt: resetsAt && !Number.isNaN(resetsAt.getTime()) ? resetsAt : undefined,
    });
    if (windows.length === MAX_WINDOWS) break;
  }
  if (windows.length === 0) {
    throw new Error("usage response contained no recognized quota windows");
  }
  return windows;
}

export async function fetchClaude(): Promise<ProviderSnapshot> {
  const fetchedAt = new Date();
  try {
    let credentials = await loadClaudeCredentials();
    if (credentials.refreshToken && credentials.expiresAt - Date.now() < CLAUDE_REFRESH_SKEW_MS) {
      credentials = await refresh(credentials);
    }
    let usage: ClaudeUsage;
    try {
      usage = await requestUsage(credentials);
    } catch (error) {
      if (!credentials.refreshToken) throw error;
      credentials = await refresh(credentials);
      usage = await requestUsage(credentials);
    }
    const plan = usagePlan(credentials);
    const windows = windowsFromClaudeUsage(usage);
    return { provider: "claude", label: "Claude", windows, plan, fetchedAt };
  } catch (error) {
    return {
      provider: "claude",
      label: "Claude",
      windows: [],
      error: error instanceof Error ? error.message : String(error),
      fetchedAt,
    };
  }
}

function usagePlan(credentials: ClaudeCredentials): string | undefined {
  const encoded = credentials.accessToken.split(".")[1];
  if (!encoded) return undefined;
  try {
    const claims = JSON.parse(
      Buffer.from(encoded.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"),
    ) as { subscriptionType?: string };
    return claims.subscriptionType;
  } catch {
    return undefined;
  }
}