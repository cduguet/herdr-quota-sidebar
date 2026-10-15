import type { Config } from "./types.ts";
import { DEFAULT_CONFIG } from "./types.ts";

function parseToml(text: string): Record<string, unknown> {
  const root: Record<string, unknown> = {};
  let table: Record<string, unknown> = root;
  for (const rawLine of text.split("\n")) {
    const line = rawLine.replace(/(^|\s)#.*$/, "").trim();
    if (!line) continue;
    const section = line.match(/^\[([^\]]+)\]$/);
    if (section) {
      const path = section[1]!.split(".").map((part) => part.trim().replace(/^"|"$/g, ""));
      let cursor = root;
      for (const key of path) {
        const next = cursor[key];
        if (typeof next !== "object" || next === null) {
          cursor[key] = {};
        }
        cursor = cursor[key] as Record<string, unknown>;
      }
      table = cursor;
      continue;
    }
    const entry = line.match(/^([A-Za-z0-9_-]+)\s*=\s*(.+)$/);
    if (!entry) continue;
    const [, key, rawValue] = entry;
    table[key!] = coerce(rawValue!);
  }
  return root;
}

function coerce(raw: string): unknown {
  const value = raw.trim();
  if (value === "true") return true;
  if (value === "false") return false;
  if (/^-?\d+$/.test(value)) return Number.parseInt(value, 10);
  if (/^-?\d*\.\d+$/.test(value)) return Number.parseFloat(value);
  const quoted = value.match(/^"(.*)"$/);
  if (quoted) return quoted[1]!.replace(/\\"/g, '"');
  const single = value.match(/^'(.*)'$/);
  if (single) return single[1]!;
  return value;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function int(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

export async function loadConfig(path: string): Promise<Config> {
  const config: Config = structuredClone(DEFAULT_CONFIG);
  const file = Bun.file(path);
  if (!(await file.exists())) return config;
  const parsed = parseToml(await file.text());

  const providers = parsed.providers as Record<string, unknown> | undefined;
  if (providers) {
    config.providers.claude = bool(providers.claude, config.providers.claude);
    config.providers.codex = bool(providers.codex, config.providers.codex);
  }
  config.refreshMinutes = int(parsed.refresh_minutes, config.refreshMinutes, 1, 24 * 60);
  config.maxWindowCount = int(parsed.max_window_count, config.maxWindowCount, 1, 8);
  config.staleAfterMinutes = int(parsed.stale_after_minutes, config.staleAfterMinutes, 1, 24 * 60);
  const prefix = typeof parsed.token_prefix === "string" ? parsed.token_prefix.trim() : "";
  if (/^[A-Za-z0-9_-]{1,24}$/.test(prefix)) config.tokenPrefix = prefix;
  return config;
}

export function serializeConfig(config: Config): string {
  return [
    "# Quota Sidebar plugin configuration",
    "# Every value is optional; the plugin falls back to the defaults below.",
    "",
    "# Minutes between quota refreshes (1-1440).",
    `refresh_minutes = ${config.refreshMinutes}`,
    "",
    "# Maximum number of windows rendered per provider (1-8).",
    `max_window_count = ${config.maxWindowCount}`,
    "",
    "# Mark tokens stale after this many minutes and fall back to the last good value (1-1440).",
    `stale_after_minutes = ${config.staleAfterMinutes}`,
    "",
    '# Prefix for the reported metadata tokens, e.g. "quota" gives $quota_claude_5h.',
    `token_prefix = "${config.tokenPrefix}"`,
    "",
    "[providers]",
    `claude = ${config.providers.claude}`,
    `codex = ${config.providers.codex}`,
    "",
    "# Add your tokens to the sidebar in ~/.config/herdr/config.toml:",
    "#",
    "# [ui.sidebar.spaces]",
    "# rows = [",
    '#   ["state_icon", "workspace"],',
    '#   [{ token = "$quota_claude_5h", fg = "#D97757" }],',
    '#   [{ token = "$quota_claude_wk", fg = "#D97757" }],',
    '#   [{ token = "$quota_codex_7d",  fg = "#10A37F" }],',
    "# ]",
    "",
  ].join("\n");
}