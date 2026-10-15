import { spawnSync } from "node:child_process";
import { isRecord, parseJson, stringField } from "./guards.ts";
import { fetchClaude } from "./providers/claude.ts";
import { fetchCodex } from "./providers/codex.ts";
import { tokenValues } from "./render.ts";
import { loadState, saveState, type PluginState } from "./state.ts";
import type { Config, ProviderSnapshot } from "./types.ts";

const MAX_TOKENS_PER_REQUEST = 16;
const PUBLISHER_SOURCE = "community.quota-sidebar";

export type PublishContext = {
  config: Config;
  statePath: string;
  binPath: string;
  /** Ignore the refresh throttle; set for manual action invocations. */
  force: boolean;
};

type HerdrCall = { args: string[]; payload: Record<string, unknown> };

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
    if (!lastGood || lastGood.error || lastGood.windows.length === 0) return snapshot;
    return { ...lastGood, error: `stale: ${snapshot.error}`, fetchedAt: lastGood.fetchedAt };
  });
}

async function collect(config: Config, previous: ProviderSnapshot[]): Promise<ProviderSnapshot[]> {
  const fresh: ProviderSnapshot[] = [];
  if (config.providers.claude) fresh.push(await fetchClaude());
  if (config.providers.codex) fresh.push(await fetchCodex(codexHome()));
  return mergeSnapshots(fresh, previous);
}

export function tokenValuesFor(
  snapshots: ProviderSnapshot[],
  config: Config,
  now: Date,
): Record<string, string> {
  const tokens: Record<string, string> = {};
  for (const snapshot of snapshots) {
    Object.assign(tokens, tokenValues(snapshot, config.tokenPrefix, now));
  }
  return tokens;
}

function callHerdr(call: HerdrCall, binPath: string): void {
  const result = spawnSync(binPath, call.args, { encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${call.args.join(" ")} failed: ${result.stderr?.trim() || result.status}`);
  }
}

type TokenHolder = { id: string; tokenNames: string[] };

function holders(entries: unknown, idField: string): TokenHolder[] {
  const found: TokenHolder[] = [];
  if (!Array.isArray(entries)) return found;
  for (const entry of entries) {
    const id = stringField(entry, idField);
    if (!id) continue;
    const tokens = isRecord(entry) ? entry.tokens : undefined;
    found.push({ id, tokenNames: isRecord(tokens) ? Object.keys(tokens) : [] });
  }
  return found;
}

/** Workspaces in sidebar order and panes, each with the token names currently set on it. */
export function listTokenHolders(binPath: string): { workspaces: TokenHolder[]; panes: TokenHolder[] } {
  const result = spawnSync(binPath, ["api", "snapshot"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error(`api snapshot failed: ${result.stderr?.trim()}`);
  const parsed = parseJson(result.stdout);
  const body = isRecord(parsed) ? parsed.result : undefined;
  const snapshot = isRecord(body) ? body.snapshot : undefined;
  if (!isRecord(snapshot)) throw new Error("api snapshot returned no snapshot");
  return {
    workspaces: holders(snapshot.workspaces, "workspace_id"),
    panes: holders(snapshot.panes, "pane_id"),
  };
}

function reportArgs(kind: "workspace" | "pane", id: string, seq: number, tokens: string[], ttlMs?: number): string[] {
  return [
    kind,
    "report-metadata",
    id,
    "--source",
    PUBLISHER_SOURCE,
    "--seq",
    String(seq),
    ...(ttlMs === undefined ? [] : ["--ttl-ms", String(ttlMs)]),
    ...tokens.flatMap((token) => ["--token", token]),
  ];
}

/** Sets `tokens` on one workspace, split into requests Herdr accepts. */
export function publishTokens(
  args: {
    binPath: string;
    workspaceId: string;
    tokens: Record<string, string>;
    seq: number;
    ttlMs: number;
  },
  exec: (call: HerdrCall) => void = (call) => callHerdr(call, args.binPath),
): void {
  const entries = Object.entries(args.tokens);
  for (let index = 0; index < entries.length; index += MAX_TOKENS_PER_REQUEST) {
    const payload = Object.fromEntries(entries.slice(index, index + MAX_TOKENS_PER_REQUEST));
    const tokens = Object.entries(payload).map(([name, value]) => `${name}=${value}`);
    exec({ args: reportArgs("workspace", args.workspaceId, args.seq, tokens, args.ttlMs), payload });
  }
}

/** Removes `names` from a workspace or pane; an empty value deletes the token in Herdr. */
export function clearTokens(
  args: { binPath: string; kind: "workspace" | "pane"; id: string; names: string[]; seq: number },
  exec: (call: HerdrCall) => void = (call) => callHerdr(call, args.binPath),
): void {
  for (let index = 0; index < args.names.length; index += MAX_TOKENS_PER_REQUEST) {
    const names = args.names.slice(index, index + MAX_TOKENS_PER_REQUEST);
    exec({
      args: reportArgs(args.kind, args.id, args.seq, names.map((name) => `${name}=`)),
      payload: Object.fromEntries(names.map((name) => [name, ""])),
    });
  }
}

export async function publish(context: PublishContext): Promise<PluginState> {
  const previous = loadState(context.statePath);
  const age = Date.now() - previous.publishedAt;
  if (!context.force && age < context.config.refreshMinutes * 60_000) return previous;
  // Claim the slot before the slow network fetch so a burst of events publishes once.
  saveState(context.statePath, { ...previous, publishedAt: Date.now() });
  const snapshots = await collect(context.config, previous.snapshots);
  // Two sequence numbers per run: Herdr drops a repeated seq, and clears precede the publish.
  const seq = previous.seq + 2;
  const state: PluginState = { seq, publishedAt: Date.now(), snapshots };
  saveState(context.statePath, state);

  const tokens = tokenValuesFor(snapshots, context.config, new Date());
  const ttlMs = Math.min(context.config.staleAfterMinutes * 60_000, 86_400_000);
  // Sidebar rows render per workspace, so showing the quota once means one anchor
  // workspace (the first in the sidebar) carries the tokens and everything else carries none.
  // Tokens this plugin set earlier (other workspaces, panes, retired names) are removed too.
  const { workspaces, panes } = listTokenHolders(context.binPath);
  const [anchor] = workspaces;
  if (anchor === undefined) return state;
  const ours = `${context.config.tokenPrefix}_`;
  const strays = (holder: TokenHolder, keep: Set<string>) =>
    holder.tokenNames.filter((name) => name.startsWith(ours) && !keep.has(name));
  const keepOnAnchor = new Set(Object.keys(tokens));
  const targets = [
    ...workspaces.map((holder) => ({ kind: "workspace" as const, holder, keep: holder === anchor ? keepOnAnchor : new Set<string>() })),
    ...panes.map((holder) => ({ kind: "pane" as const, holder, keep: new Set<string>() })),
  ];
  for (const { kind, holder, keep } of targets) {
    const names = strays(holder, keep);
    if (names.length > 0) clearTokens({ binPath: context.binPath, kind, id: holder.id, names, seq: seq - 1 });
  }
  publishTokens({ binPath: context.binPath, workspaceId: anchor.id, tokens, seq, ttlMs });
  return state;
}
