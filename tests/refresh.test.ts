import { describe, expect, test } from "bun:test";
import { mergeSnapshots } from "../src/refresh.ts";
import type { Window } from "../src/types.ts";

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
