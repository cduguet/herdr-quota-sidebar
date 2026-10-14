import { isRecord, numberField, parseJson, stringField } from "../guards.ts";
import type { ProviderSnapshot, Window } from "../types.ts";

export type CodexAuth = {
  accessToken: string;
  refreshToken: string;
  accountId?: string;
  lastRefresh?: string;
};

type CodexWindow = {
  used_percent?: number;
  reset_at?: number;
  limit_window_seconds?: number;
};

export type CodexUsage = {
  plan_type?: string;
  rate_limit?: { primary_window?: CodexWindow; secondary_window?: CodexWindow };
  code_review_rate_limit?: { primary_window?: CodexWindow };
  credits?: { has_credits?: boolean; unlimited?: boolean; balance?: number | string };
};

export function parseCodexAuth(document: string): CodexAuth | undefined {
  const parsed = parseJson(document);
  if (!isRecord(parsed)) return undefined;
  const tokens = parsed.tokens;
  if (!isRecord(tokens)) return undefined;
  const accessToken = stringField(tokens, "access_token");
  if (!accessToken) return undefined;
  return {
    accessToken,
    refreshToken: stringField(tokens, "refresh_token") ?? "",
    accountId: stringField(tokens, "account_id"),
    lastRefresh: stringField(parsed, "last_refresh"),
  };
}

export async function loadCodexAuth(path: string): Promise<CodexAuth> {
  const file = Bun.file(path);
  if (!(await file.exists())) {
    throw new Error(`no Codex credentials at ${path} (log in with \`codex login\`)`);
  }
  const auth = parseCodexAuth(await file.text());
  if (!auth) throw new Error(`unrecognized credential shape in ${path}`);
  return auth;
}

export async function requestCodexUsage(auth: CodexAuth): Promise<CodexUsage> {
  const headers: Record<string, string> = {
    authorization: `Bearer ${auth.accessToken}`,
    accept: "application/json",
    "user-agent": "herdr-quota-sidebar",
  };
  if (auth.accountId) headers["chatgpt-account-id"] = auth.accountId;
  const response = await fetch("https://chatgpt.com/backend-api/wham/usage", {
    headers,
    signal: AbortSignal.timeout(15000),
  });
  if (response.status === 401 || response.status === 403) {
    throw new Error(`unauthorized (${response.status})`);
  }
  if (!response.ok) throw new Error(`usage request failed: ${response.status}`);
  const payload: unknown = await response.json();
  if (!isRecord(payload)) throw new Error("usage response was not an object");
  return payload as CodexUsage;
}

function windowLabel(seconds: number | undefined, fallback: string): string {
  if (!seconds || seconds <= 0) return fallback;
  const hours = seconds / 3600;
  if (hours < 24) return `${Math.round(hours)}h`;
  return `${Math.round(hours / 24)}d`;
}

function toWindow(entry: CodexWindow | undefined, fallback: string): Window | undefined {
  if (!entry || typeof entry.used_percent !== "number") return undefined;
  const seconds = entry.limit_window_seconds;
  return {
    label: windowLabel(seconds, fallback),
    usedPercent: Math.max(0, Math.min(100, entry.used_percent)),
    resetsAt: (() => {
      const reset = numberField(entry, "reset_at");
      return reset === undefined ? undefined : new Date(reset * 1000);
    })(),
  };
}

export function windowsFromCodexUsage(usage: CodexUsage): Window[] {
  const windows = [
    toWindow(usage.rate_limit?.primary_window, "session"),
    toWindow(usage.rate_limit?.secondary_window, "wk"),
    toWindow(usage.code_review_rate_limit?.primary_window, "review"),
  ].filter((window): window is Window => window !== undefined);
  if (windows.length === 0) {
    throw new Error("usage response contained no recognized quota windows");
  }
  return windows;
}

export async function fetchCodex(configDir: string): Promise<ProviderSnapshot> {
  const fetchedAt = new Date();
  try {
    const auth = await loadCodexAuth(`${configDir}/auth.json`);
    const usage = await requestCodexUsage(auth);
    const windows = windowsFromCodexUsage(usage);
    const credits = usage.credits;
    const balance = credits?.balance;
    const balanceText =
      typeof balance === "number" ? String(balance) : typeof balance === "string" ? balance : "";
    const detail =
      credits?.has_credits && Number.parseFloat(balanceText) > 0 ? `credits ${balanceText}` : undefined;
    return {
      provider: "codex",
      label: "Codex",
      windows,
      plan: usage.plan_type,
      detail,
      fetchedAt,
    };
  } catch (error) {
    return {
      provider: "codex",
      label: "Codex",
      windows: [],
      error: error instanceof Error ? error.message : String(error),
      fetchedAt,
    };
  }
}