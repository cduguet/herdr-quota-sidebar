import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { isRecord, numberField, stringField } from "./guards.ts";
import type { ProviderSnapshot, Window } from "./types.ts";

export type PluginState = {
  seq: number;
  snapshots: ProviderSnapshot[];
};

const EMPTY_STATE: PluginState = { seq: 0, snapshots: [] };

function reviveWindow(value: unknown): Window | undefined {
  if (!isRecord(value)) return undefined;
  const label = stringField(value, "label");
  const usedPercent = numberField(value, "usedPercent");
  if (label === undefined || usedPercent === undefined) return undefined;
  const rawResets = stringField(value, "resetsAt");
  const resetsAt = rawResets === undefined ? undefined : new Date(rawResets);
  return {
    label,
    usedPercent,
    resetsAt: resetsAt && !Number.isNaN(resetsAt.getTime()) ? resetsAt : undefined,
  };
}

function reviveSnapshot(value: unknown): ProviderSnapshot | undefined {
  if (!isRecord(value)) return undefined;
  const provider = stringField(value, "provider");
  const label = stringField(value, "label");
  const fetchedAt = stringField(value, "fetchedAt");
  if (provider === undefined || label === undefined || fetchedAt === undefined) return undefined;
  const windows: Window[] = [];
  if (Array.isArray(value.windows)) {
    for (const entry of value.windows) {
      const window = reviveWindow(entry);
      if (window) windows.push(window);
    }
  }
  return {
    provider,
    label,
    windows,
    plan: stringField(value, "plan"),
    detail: stringField(value, "detail"),
    error: stringField(value, "error"),
    fetchedAt: new Date(fetchedAt),
  };
}

export function loadState(path: string): PluginState {
  if (!existsSync(path)) return EMPTY_STATE;
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (!isRecord(parsed)) return EMPTY_STATE;
    const snapshots: ProviderSnapshot[] = [];
    if (Array.isArray(parsed.snapshots)) {
      for (const entry of parsed.snapshots) {
        const snapshot = reviveSnapshot(entry);
        if (snapshot) snapshots.push(snapshot);
      }
    }
    return { seq: numberField(parsed, "seq") ?? 0, snapshots };
  } catch {
    return EMPTY_STATE;
  }
}

export function saveState(path: string, state: PluginState): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}