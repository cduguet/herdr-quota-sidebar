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
};

type HerdrCall = { args: string[]; payload: Record<string, unknown> };

function pluginConfigPath(): string {
  const dir = process.env.HERDR_PLUGIN_CONFIG_DIR;
  return dir ? `${dir}/config.toml` : `${process.env.HOME}/.config/herdr/quota-sidebar.toml`;
}

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
    Object.assign(tokens, tokenValues(snapshot, config.tokenPrefix, config.maxWindowCount, now));
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

/** Panes running a coding agent, which are the rows the quota tokens are meant for. */
export function agentPaneIds(binPath: string, workspaceId: string): string[] {
  const result = spawnSync(binPath, ["pane", "list", "--workspace", workspaceId], { encoding: "utf8" });
  if (result.error || result.status !== 0) return [];
  const parsed = parseJson(result.stdout);
  if (!isRecord(parsed)) return [];
  const body = parsed.result;
  if (!isRecord(body) || !Array.isArray(body.panes)) return [];
  const ids: string[] = [];
  for (const entry of body.panes) {
    const paneId = stringField(entry, "pane_id");
    if (paneId && stringField(entry, "agent")) ids.push(paneId);
  }
  return ids;
}

export function publishTokens(
  args: {
    binPath: string;
    workspaceId: string;
    paneIds: string[];
    tokens: Record<string, string>;
    seq: number;
    ttlMs: number;
  },
  exec: (call: HerdrCall) => void = (call) => callHerdr(call, args.binPath),
): void {
  const entries = Object.entries(args.tokens);
  const payloads: Record<string, string>[] = [];
  for (let index = 0; index < entries.length; index += MAX_TOKENS_PER_REQUEST) {
    payloads.push(Object.fromEntries(entries.slice(index, index + MAX_TOKENS_PER_REQUEST)));
  }
  for (const payload of payloads) {
    exec({
      args: [
        "workspace",
        "report-metadata",
        args.workspaceId,
        "--source",
        PUBLISHER_SOURCE,
        "--seq",
        String(args.seq),
        "--ttl-ms",
        String(args.ttlMs),
        ...Object.entries(payload).flatMap(([name, value]) => ["--token", `${name}=${value}`]),
      ],
      payload,
    });
  }
  for (const paneId of args.paneIds) {
    for (const payload of payloads) {
      exec({
        args: [
          "pane",
          "report-metadata",
          paneId,
          "--source",
          PUBLISHER_SOURCE,
          "--seq",
          String(args.seq),
          "--ttl-ms",
          String(args.ttlMs),
          ...Object.entries(payload).flatMap(([name, value]) => ["--token", `${name}=${value}`]),
        ],
        payload,
      });
    }
  }
}

export async function publish(context: PublishContext): Promise<PluginState> {
  const previous = loadState(context.statePath);
  const snapshots = await collect(context.config, previous.snapshots);
  const seq = previous.seq + 1;
  const state: PluginState = { seq, snapshots };
  saveState(context.statePath, state);

  const workspaceId = process.env.HERDR_WORKSPACE_ID;
  if (!workspaceId) {
    return state;
  }
  const tokens = tokenValuesFor(snapshots, context.config, new Date());
  publishTokens({
    binPath: context.binPath,
    workspaceId,
    paneIds: agentPaneIds(context.binPath, workspaceId),
    tokens,
    seq,
    ttlMs: Math.min(context.config.staleAfterMinutes * 60_000, 86_400_000),
  });
  return state;
}

export { pluginConfigPath };