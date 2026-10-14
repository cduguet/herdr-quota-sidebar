import { describe, expect, test } from "bun:test";
import { publishTokens } from "../src/publish.ts";
import type { Window } from "../src/types.ts";
import { mergeSnapshots } from "../src/publish.ts";

describe("publishTokens", () => {
  const base = {
    binPath: "/bin/true",
    workspaceId: "w2",
    tokens: { quota_claude_5h: "5h 9%" },
    seq: 3,
    ttlMs: 60_000,
  };

  test("reports workspace tokens when there are no panes", () => {
    const calls: string[][] = [];
    publishTokens({ ...base, paneIds: [] }, (call) => calls.push(call.args));
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual([
      "workspace",
      "report-metadata",
      "w2",
      "--source",
      "community.quota-sidebar",
      "--seq",
      "3",
      "--ttl-ms",
      "60000",
      "--token",
      "quota_claude_5h=5h 9%",
    ]);
  });

  test("mirrors tokens onto every agent pane", () => {
    const targets: string[][] = [];
    publishTokens({ ...base, paneIds: ["w2:pA", "w2:pB"] }, (call) => targets.push(call.args));
    expect(targets).toHaveLength(3);
    expect(targets.slice(1).map((args) => args[1])).toEqual(["report-metadata", "report-metadata"]);
    expect(targets.slice(1).map((args) => args[2])).toEqual(["w2:pA", "w2:pB"]);
  });

  test("splits more than 16 tokens into multiple requests", () => {
    const tokens: Record<string, string> = {};
    for (let index = 0; index < 20; index += 1) tokens[`quota_key_${index}`] = `v${index}`;
    const calls: Array<{ args: string[]; payload: Record<string, unknown> }> = [];
    publishTokens({ ...base, tokens, paneIds: [] }, (call) => calls.push(call));
    expect(calls.map((call) => Object.keys(call.payload).length)).toEqual([16, 4]);
  });
});

describe("mergeSnapshots", () => {
  const windows: Window[] = [{ label: "5h", usedPercent: 10 }];
  const good = {
    provider: "claude",
    label: "Claude",
    windows,
    fetchedAt: new Date("2026-10-14T12:00:00Z"),
  };

  test("keeps the last good windows when a refresh fails", () => {
    const merged = mergeSnapshots(
      [{ provider: "claude", label: "Claude", windows: [], error: "unauthorized (401)", fetchedAt: new Date() }],
      [good],
    );
    expect(merged[0]!.windows).toEqual(windows);
    expect(merged[0]!.error).toBe("stale: unauthorized (401)");
    expect(merged[0]!.fetchedAt.toISOString()).toBe("2026-10-14T12:00:00.000Z");
  });

  test("surfaces the failure when there is no prior good snapshot", () => {
    const merged = mergeSnapshots(
      [{ provider: "codex", label: "Codex", windows: [], error: "boom", fetchedAt: new Date() }],
      [],
    );
    expect(merged[0]!.error).toBe("boom");
    expect(merged[0]!.windows).toEqual([]);
  });

  test("passes healthy snapshots through untouched", () => {
    expect(mergeSnapshots([good], [])).toEqual([good]);
  });
});