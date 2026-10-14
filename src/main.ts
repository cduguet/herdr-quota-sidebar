#!/usr/bin/env bun
import { loadConfig } from "./config.ts";
import { publish } from "./publish.ts";
import { headroom, formatWindow } from "./render.ts";
import { loadState } from "./state.ts";
import type { ProviderSnapshot } from "./types.ts";

function pluginConfigPath(): string {
  const dir = process.env.HERDR_PLUGIN_CONFIG_DIR;
  return dir ? `${dir}/config.toml` : `${process.env.HOME}/.config/herdr/quota-sidebar.toml`;
}

function statePath(): string {
  const dir = process.env.HERDR_PLUGIN_STATE_DIR;
  return dir ? `${dir}/snapshots.json` : `${process.env.HOME}/.local/state/herdr/quota-sidebar.json`;
}

function binPath(): string {
  return process.env.HERDR_BIN_PATH ?? "herdr";
}

function showSnapshot(snapshot: ProviderSnapshot, now: Date): string {
  const head = `${snapshot.label}${snapshot.plan ? ` (${snapshot.plan})` : ""}`;
  if (snapshot.error) return `${head}: ${snapshot.error}`;
  const windows = snapshot.windows.map((window) => formatWindow(window, now)).join("  ");
  const worst = headroom(snapshot);
  const left = worst ? `  -> ${Math.round(100 - worst.usedPercent)}% headroom` : "";
  const detail = snapshot.detail ? `  (${snapshot.detail})` : "";
  return `${head}: ${windows}${left}${detail}`;
}

async function main(): Promise<void> {
  const config = await loadConfig(pluginConfigPath());
  const command = process.argv[2] ?? "publish";
  const now = new Date();

  if (command === "show") {
    const state = loadState(statePath());
    if (state.snapshots.length === 0) {
      process.stdout.write("no snapshot yet; run `publish` first\n");
      return;
    }
    for (const snapshot of state.snapshots) {
      process.stdout.write(`${showSnapshot(snapshot, now)}\n`);
    }
    return;
  }

  const state = await publish({ config, statePath: statePath(), binPath: binPath() });
  for (const snapshot of state.snapshots) {
    process.stdout.write(`${showSnapshot(snapshot, now)}\n`);
  }
}

try {
  await main();
  process.exit(0);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}