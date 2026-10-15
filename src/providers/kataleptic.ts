import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { isRecord, numberField, stringField } from "../guards.ts";
import type { ProviderSnapshot } from "../types.ts";

const execFileAsync = promisify(execFile);

/** Dollars spent in the UTC calendar day containing `now`, from a `/v1/billing/usage` response. */
export function spendToday(usage: unknown, now: Date): number {
  if (!isRecord(usage) || !Array.isArray(usage.by_day)) throw new Error("usage response had no by_day");
  const today = now.toISOString().slice(0, 10);
  for (const entry of usage.by_day) {
    if (stringField(entry, "date") === today) return numberField(entry, "cost_usd") ?? 0;
  }
  return 0;
}

async function readApiKey(keyCommand: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync("/bin/sh", ["-c", keyCommand], { timeout: 20000, encoding: "utf8" });
    const key = stdout.trim();
    if (!key) throw new Error("empty output");
    return key;
  } catch (error) {
    // Never include stdout/stderr: they may carry the secret.
    const reason = error instanceof Error && "killed" in error && error.killed ? "timed out" : "failed";
    throw new Error(`kataleptic key_command ${reason}`);
  }
}

export async function fetchKataleptic(keyCommand: string, now = new Date()): Promise<ProviderSnapshot> {
  const base = { provider: "kataleptic", label: "Kataleptic", windows: [], fetchedAt: now };
  try {
    const key = await readApiKey(keyCommand);
    const response = await fetch("https://api.kataleptic.com/v1/billing/usage?days=1", {
      headers: { authorization: `Bearer ${key}`, accept: "application/json", "user-agent": "herdr-quota-sidebar" },
      signal: AbortSignal.timeout(15000),
    });
    if (response.status === 401 || response.status === 403) throw new Error(`unauthorized (${response.status})`);
    if (!response.ok) throw new Error(`usage request failed: ${response.status}`);
    return { ...base, spendUsd: spendToday(await response.json(), now) };
  } catch (error) {
    return { ...base, error: error instanceof Error ? error.message : String(error) };
  }
}
