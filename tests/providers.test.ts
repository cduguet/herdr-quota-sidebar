import { describe, expect, test } from "bun:test";
import { windowsFromClaudeUsage } from "../src/providers/claude.ts";
import { parseCodexAuth, windowsFromCodexUsage } from "../src/providers/codex.ts";
import { loadConfig, serializeConfig } from "../src/config.ts";
import { DEFAULT_CONFIG } from "../src/types.ts";
import { formatBar, formatWindow, tokenValues } from "../src/render.ts";
import { loadState, saveState } from "../src/state.ts";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const NOW = new Date("2026-10-14T12:00:00Z");

describe("windowsFromClaudeUsage", () => {
  test("maps known windows in priority order and clamps utilization", () => {
    const windows = windowsFromClaudeUsage({
      five_hour: { utilization: 42, resets_at: "2026-10-14T15:00:00Z" },
      seven_day: { utilization: 140, resets_at: "2026-10-18T12:00:00Z" },
      seven_day_opus: { utilization: -3 },
      irrelevant: { utilization: 99 },
    });
    expect(windows.map((w) => [w.label, w.usedPercent])).toEqual([
      ["5h", 42],
      ["wk", 100],
      ["opus", 0],
    ]);
    expect(windows[0]!.resetsAt?.toISOString()).toBe("2026-10-14T15:00:00.000Z");
    expect(windows[2]!.resetsAt).toBeUndefined();
  });

  test("ignores malformed reset timestamps", () => {
    const windows = windowsFromClaudeUsage({ five_hour: { utilization: 1, resets_at: "nope" } });
    expect(windows[0]!.resetsAt).toBeUndefined();
  });

  test("caps at four windows", () => {
    const windows = windowsFromClaudeUsage({
      five_hour: { utilization: 1 },
      seven_day: { utilization: 2 },
      seven_day_opus: { utilization: 3 },
      seven_day_omelette: { utilization: 4 },
      seven_day_oauth_apps: { utilization: 5 },
    });
    expect(windows.map((w) => w.label)).toEqual(["5h", "wk", "opus", "design"]);
  });

  test("throws when nothing recognizable is present", () => {
    expect(() => windowsFromClaudeUsage({ unexpected: { utilization: 1 } })).toThrow();
  });
});

describe("windowsFromCodexUsage", () => {
  test("derives labels from limit_window_seconds", () => {
    const windows = windowsFromCodexUsage({
      rate_limit: {
        primary_window: { used_percent: 12.6, reset_at: 1_800_000_000, limit_window_seconds: 18000 },
        secondary_window: { used_percent: 88, limit_window_seconds: 604800 },
      },
      code_review_rate_limit: { primary_window: { used_percent: 5, limit_window_seconds: 3600 } },
    });
    expect(windows.map((w) => w.label)).toEqual(["5h", "7d", "1h"]);
    expect(windows[0]!.resetsAt?.getTime()).toBe(1_800_000_000_000);
  });

  test("falls back to fixed labels without a window duration", () => {
    const windows = windowsFromCodexUsage({
      rate_limit: { primary_window: { used_percent: 1 }, secondary_window: { used_percent: 2 } },
    });
    expect(windows.map((w) => w.label)).toEqual(["session", "wk"]);
  });

  test("throws when no window has a used_percent", () => {
    expect(() => windowsFromCodexUsage({ rate_limit: { primary_window: {} } })).toThrow();
  });
});

describe("parseCodexAuth", () => {
  test("accepts a chatgpt auth file", () => {
    const auth = parseCodexAuth(
      JSON.stringify({
        auth_mode: "chatgpt",
        tokens: { access_token: "a", refresh_token: "r", account_id: "acct" },
      }),
    );
    expect(auth).toEqual({
      accessToken: "a",
      refreshToken: "r",
      accountId: "acct",
      lastRefresh: undefined,
    });
  });

  test("rejects payloads without an access token", () => {
    expect(parseCodexAuth(JSON.stringify({ tokens: { refresh_token: "r" } }))).toBeUndefined();
    expect(parseCodexAuth("not json")).toBeUndefined();
    expect(parseCodexAuth(JSON.stringify([1, 2]))).toBeUndefined();
  });
});

describe("loadConfig", () => {
  test("returns defaults when the file is absent", async () => {
    const dir = mkdtempSync(join(tmpdir(), "quota-config-"));
    expect(await loadConfig(join(dir, "missing.toml"))).toEqual(DEFAULT_CONFIG);
  });

  test("reads overrides, clamps range, and rejects a bad prefix", async () => {
    const dir = mkdtempSync(join(tmpdir(), "quota-config-"));
    const path = join(dir, "config.toml");
    await Bun.write(
      path,
      [
        "refresh_minutes = 99999",
        "max_window_count = 2",
        'token_prefix = "bad prefix!"',
        "",
        "[providers]",
        "claude = false",
      ].join("\n"),
    );
    const config = await loadConfig(path);
    expect(config.providers.claude).toBe(false);
    expect(config.providers.codex).toBe(true);
    expect(config.refreshMinutes).toBe(1440);
    expect(config.maxWindowCount).toBe(2);
    expect(config.tokenPrefix).toBe("quota");
  });

  test("round-trips through serializeConfig", async () => {
    const dir = mkdtempSync(join(tmpdir(), "quota-config-"));
    const path = join(dir, "config.toml");
    const custom = { ...DEFAULT_CONFIG, tokenPrefix: "ai", refreshMinutes: 9, staleAfterMinutes: 45 };
    await Bun.write(path, serializeConfig(custom));
    expect(await loadConfig(path)).toEqual(custom);
  });
});

describe("tokenValues", () => {
  const snapshot = {
    provider: "claude",
    label: "Claude",
    plan: "max",
    windows: [
      { label: "5h", usedPercent: 30, resetsAt: new Date("2026-10-14T13:20:00Z") },
      { label: "wk", usedPercent: 75 },
    ],
    fetchedAt: NOW,
  };

  test("emits per-window, aggregate, and status tokens", () => {
    const tokens = tokenValues(snapshot, "quota", 4, NOW);
    expect(tokens.quota_claude_5h).toBe("✻ 5h ██░░░░░░ 30% 1h");
    expect(tokens.quota_claude_wk).toBe("✻ wk ██████░░ 75%");
    expect(tokens.quota_claude_text).toBe("5h 30% 1h wk 75%");
    expect(tokens.quota_claude_left).toBe("25% left");
    expect(tokens.quota_claude_plan).toBe("max");
    expect(tokens.quota_claude_status).toBe("updated 0m ago");
  });

  test("respects maxWindowCount", () => {
    const tokens = tokenValues(snapshot, "quota", 1, NOW);
    expect(tokens.quota_claude_text).toBe("5h 30% 1h");
    expect(tokens.quota_claude_wk).toBeUndefined();
  });

  test("reports errors without stale window tokens", () => {
    const tokens = tokenValues({ ...snapshot, windows: [], error: "unauthorized (401)" }, "quota", 4, NOW);
    expect(tokens.quota_claude_status).toBe("unauthorized (401)");
    expect(tokens.quota_claude_text).toBe("Claude n/a");
    expect(tokens.quota_claude_5h).toBeUndefined();
  });

  test("token names satisfy the Herdr pattern", () => {
    for (const name of Object.keys(tokenValues(snapshot, "quota", 4, NOW))) {
      expect(name).toMatch(/^[A-Za-z0-9_-]{1,32}$/);
    }
  });
});

describe("formatBar", () => {
  test("fills proportionally and clamps out-of-range input", () => {
    expect(formatBar(0)).toBe("░░░░░░░░");
    expect(formatBar(50)).toBe("████░░░░");
    expect(formatBar(100)).toBe("████████");
    expect(formatBar(250)).toBe("████████");
    expect(formatBar(-5)).toBe("░░░░░░░░");
  });

  test("aligns bars across windows with different label lengths", () => {
    const tokens = tokenValues(
      {
        provider: "codex",
        label: "Codex",
        windows: [
          { label: "7d", usedPercent: 10 },
          { label: "review", usedPercent: 10 },
        ],
        fetchedAt: NOW,
      },
      "quota",
      4,
      NOW,
    );
    expect(tokens.quota_codex_7d).toBe("◆ 7d     █░░░░░░░ 10%");
    expect(tokens.quota_codex_review).toBe("◆ review █░░░░░░░ 10%");
  });
});

describe("formatWindow", () => {
  test("uses minutes, hours, then days for the reset delta", () => {
    expect(formatWindow({ label: "5h", usedPercent: 1, resetsAt: new Date(NOW.getTime() + 90_000) }, NOW)).toBe("5h 1% 2m");
    expect(formatWindow({ label: "5h", usedPercent: 1, resetsAt: new Date(NOW.getTime() + 7_200_000) }, NOW)).toBe("5h 1% 2h");
    expect(formatWindow({ label: "5h", usedPercent: 1, resetsAt: new Date(NOW.getTime() + 3 * 86_400_000) }, NOW)).toBe("5h 1% 3d");
    expect(formatWindow({ label: "5h", usedPercent: 1, resetsAt: new Date(NOW.getTime() - 1000) }, NOW)).toBe("5h 1% now");
  });
});

describe("state cache", () => {
  test("round-trips snapshots and survives corrupt files", () => {
    const dir = mkdtempSync(join(tmpdir(), "quota-state-"));
    const path = join(dir, "snapshots.json");
    saveState(path, {
      seq: 7,
      snapshots: [
        {
          provider: "codex",
          label: "Codex",
          windows: [{ label: "5h", usedPercent: 12, resetsAt: new Date("2026-10-14T20:00:00Z") }],
          fetchedAt: NOW,
        },
      ],
    });
    const state = loadState(path);
    expect(state.seq).toBe(7);
    expect(state.snapshots[0]!.windows[0]!.usedPercent).toBe(12);
    expect(state.snapshots[0]!.windows[0]!.resetsAt?.toISOString()).toBe("2026-10-14T20:00:00.000Z");

    Bun.write(path, "{ truncated");
    expect(loadState(path)).toEqual({ seq: 0, snapshots: [] });
    expect(loadState(join(dir, "nope.json"))).toEqual({ seq: 0, snapshots: [] });
  });
});