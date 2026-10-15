import { fetchClaude } from "./providers/claude.ts";
import { fetchCodex } from "./providers/codex.ts";
import { fetchKataleptic } from "./providers/kataleptic.ts";
import { loadState, saveState, type PluginState } from "./state.ts";
import type { Config, ProviderSnapshot } from "./types.ts";

export type RefreshContext = {
  config: Config;
  statePath: string;
  /** Ignore the refresh throttle; set for manual action invocations. */
  force: boolean;
};

function codexHome(): string {
  const dir = process.env.CODEX_HOME;
  if (dir) return dir;
  return `${process.env.HOME}/.codex`;
}

/** Never trust a snapshot that failed; keep the last good value for that provider. */
export function mergeSnapshots(fresh: ProviderSnapshot[], previous: ProviderSnapshot[]): ProviderSnapshot[] {
  return fresh.map((snapshot) => {
    if (!snapshot.error) return snapshot;
    const lastGood = previous.find((candidate) => candidate.provider === snapshot.provider);
    if (!lastGood || lastGood.error || (lastGood.windows.length === 0 && lastGood.spendUsd === undefined)) return snapshot;
    return { ...lastGood, error: `stale: ${snapshot.error}`, fetchedAt: lastGood.fetchedAt };
  });
}

async function collect(config: Config, previous: ProviderSnapshot[]): Promise<ProviderSnapshot[]> {
  const fresh: ProviderSnapshot[] = [];
  if (config.providers.claude) fresh.push(await fetchClaude());
  if (config.providers.codex) fresh.push(await fetchCodex(codexHome()));
  if (config.kataleptic.keyCommand) fresh.push(await fetchKataleptic(config.kataleptic.keyCommand));
  return mergeSnapshots(fresh, previous);
}

/** Refreshes the cached snapshots unless they are younger than `refresh_minutes` (and not forced). */
export async function refresh(context: RefreshContext): Promise<PluginState> {
  const previous = loadState(context.statePath);
  const age = Date.now() - previous.publishedAt;
  if (!context.force && age < context.config.refreshMinutes * 60_000) return previous;
  // Claim the slot before the slow network fetch so overlapping runs fetch once.
  saveState(context.statePath, { ...previous, publishedAt: Date.now() });
  const snapshots = await collect(context.config, previous.snapshots);
  const state: PluginState = { publishedAt: Date.now(), snapshots };
  saveState(context.statePath, state);
  return state;
}
