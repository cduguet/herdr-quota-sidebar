import { describe, expect, test } from "bun:test";
import { windowsFromClaudeUsage } from "../src/providers/claude.ts";
import { spendToday } from "../src/providers/kataleptic.ts";
import { parseCodexAuth, windowsFromCodexUsage } from "../src/providers/codex.ts";
import { loadConfig, serializeConfig } from "../src/config.ts";
import { DEFAULT_CONFIG } from "../src/types.ts";
import { formatBar, formatWindow, statusLine } from "../src/render.ts";
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
    expect(windows.map((w) => w.label)).toEqual(["5h", "wk", "1h"]);
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
        'unknown_key = "ignored"',
        "",
        "[providers]",
        "claude = false",
      ].join("\n"),
    );
    const config = await loadConfig(path);
    expect(config.providers.claude).toBe(false);
    expect(config.providers.codex).toBe(true);
    expect(config.refreshMinutes).toBe(1440);
  });

  test("round-trips through serializeConfig", async () => {
    const dir = mkdtempSync(join(tmpdir(), "quota-config-"));
    const path = join(dir, "config.toml");
    const custom = {
      ...DEFAULT_CONFIG,
      refreshMinutes: 9,
      providers: { claude: false, codex: true },
      kataleptic: { keyCommand: "qsecret 'kataleptic - beast' credential" },
    };
    await Bun.write(path, serializeConfig(custom));
    expect(await loadConfig(path)).toEqual(custom);
  });
});

describe("spendToday", () => {
  const usage = {
    by_day: [
      { date: "2026-10-13", cost_usd: 0.59 },
      { date: "2026-10-14", cost_usd: 159.92 },
      { date: "2026-10-15", cost_usd: 271.4237 },
    ],
  };

  test("returns only the current UTC day, not earlier days", () => {
    expect(spendToday(usage, new Date("2026-10-15T17:33:00Z"))).toBe(271.4237);
  });

  test("is zero when nothing was spent yet today", () => {
    expect(spendToday(usage, new Date("2026-10-16T00:05:00Z"))).toBe(0);
  });

  test("rejects a response without by_day", () => {
    expect(() => spendToday({ error: "nope" }, NOW)).toThrow();
  });
});

describe("statusLine", () => {
  const claude = {
    provider: "claude",
    label: "Claude",
    plan: "max",
    windows: [
      { label: "5h", usedPercent: 30, resetsAt: new Date("2026-10-14T13:20:00Z") },
      { label: "wk", usedPercent: 46, resetsAt: new Date(NOW.getTime() + 3 * 86_400_000) },
    ],
    fetchedAt: NOW,
  };
  const codex = {
    provider: "codex",
    label: "Codex",
    windows: [{ label: "wk", usedPercent: 10, resetsAt: new Date(NOW.getTime() + 7 * 86_400_000) }],
    fetchedAt: NOW,
  };

  test("shows each provider's weekly bar by lowercase name and ignores other windows", () => {
    expect(statusLine([claude, codex], NOW)).toBe("claude wk ████░░░░ 46% 3d  codex wk █░░░░░░░ 10% 7d");
  });

  test("marks a provider with no weekly window as n/a", () => {
    expect(statusLine([{ ...claude, windows: [{ label: "5h", usedPercent: 30 }] }, codex], NOW)).toBe(
      "claude wk n/a  codex wk █░░░░░░░ 10% 7d",
    );
  });

  test("keeps the cached weekly bar when a refresh failed", () => {
    expect(statusLine([{ ...codex, error: "stale: boom" }], NOW)).toBe("codex wk █░░░░░░░ 10% 7d");
  });

  test("appends today's Kataleptic spend", () => {
    const kataleptic = { provider: "kataleptic", label: "Kataleptic", windows: [], spendUsd: 271.4237, fetchedAt: NOW };
    expect(statusLine([codex, kataleptic], NOW)).toBe("codex wk █░░░░░░░ 10% 7d  kataleptic $271.42 today");
    expect(statusLine([{ ...kataleptic, spendUsd: undefined, error: "unauthorized (401)" }], NOW)).toBe("kataleptic n/a");
  });

  test("reports n/a before the first snapshot", () => {
    expect(statusLine([], NOW)).toBe("quota n/a");
  });

  test("fits Herdr's 80-character status limit", () => {
    const kataleptic = { provider: "kataleptic", label: "Kataleptic", windows: [], spendUsd: 1234.567, fetchedAt: NOW };
    expect(statusLine([claude, codex, kataleptic], NOW).length).toBeLessThanOrEqual(80);
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
      publishedAt: 1_792_000_000_000,
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
    expect(state.publishedAt).toBe(1_792_000_000_000);
    expect(state.snapshots[0]!.windows[0]!.usedPercent).toBe(12);
    expect(state.snapshots[0]!.windows[0]!.resetsAt?.toISOString()).toBe("2026-10-14T20:00:00.000Z");

    Bun.write(path, "{ truncated");
    expect(loadState(path)).toEqual({ publishedAt: 0, snapshots: [] });
    expect(loadState(join(dir, "nope.json"))).toEqual({ publishedAt: 0, snapshots: [] });
  });
});