import type { ProviderSnapshot, Window } from "./types.ts";

const BAR_CELLS = 8;

/** One glyph per provider so a row stays identifiable without its colour. */
const PROVIDER_BADGES: Record<string, string> = { claude: "✻", codex: "◆" };

export function formatReset(resetsAt: Date | undefined, now: Date): string {
  if (!resetsAt) return "";
  const minutes = Math.round((resetsAt.getTime() - now.getTime()) / 60000);
  if (minutes <= 0) return " now";
  if (minutes < 60) return ` ${minutes}m`;
  if (minutes < 60 * 48) return ` ${Math.round(minutes / 60)}h`;
  return ` ${Math.round(minutes / (60 * 24))}d`;
}

export function formatWindow(window: Window, now: Date): string {
  return `${window.label} ${Math.round(window.usedPercent)}%${formatReset(window.resetsAt, now)}`;
}

export function formatBar(usedPercent: number): string {
  const filled = Math.min(BAR_CELLS, Math.max(0, Math.round((usedPercent / 100) * BAR_CELLS)));
  return "█".repeat(filled) + "░".repeat(BAR_CELLS - filled);
}

/** `✻ 5h ███░░░░░  44% 3d`: badge, label, bar, right-aligned percent, time to reset. */
export function formatBarLine(
  badge: string,
  window: Window,
  labelWidth: number,
  now: Date,
): string {
  const percent = `${Math.round(window.usedPercent)}%`.padStart(4);
  return `${badge} ${window.label.padEnd(labelWidth)} ${formatBar(window.usedPercent)}${percent}${formatReset(window.resetsAt, now)}`;
}

/** Highest-pressure window, used for the compact one-line variant. */
export function headroom(snapshot: ProviderSnapshot): Window | undefined {
  return snapshot.windows.reduce<Window | undefined>(
    (worst, window) => (worst === undefined || window.usedPercent > worst.usedPercent ? window : worst),
    undefined,
  );
}

export function tokenValues(
  snapshot: ProviderSnapshot,
  prefix: string,
  maxWindowCount: number,
  now: Date,
): Record<string, string> {
  const tokens: Record<string, string> = {};
  const base = `${prefix}_${snapshot.provider}`;
  if (snapshot.error) {
    tokens[`${base}_status`] = `${snapshot.error}`.slice(0, 64);
    tokens[`${base}_text`] = `${snapshot.label} n/a`;
    return tokens;
  }
  const windows = snapshot.windows.slice(0, maxWindowCount);
  const badge = PROVIDER_BADGES[snapshot.provider] ?? "•";
  const labelWidth = Math.max(...windows.map((window) => window.label.length));
  for (const window of windows) {
    tokens[`${base}_${window.label}`] = formatBarLine(badge, window, labelWidth, now);
  }
  tokens[`${base}_text`] = windows.map((window) => formatWindow(window, now)).join(" ");
  const worst = headroom(snapshot);
  if (worst) tokens[`${base}_left`] = `${Math.round(100 - worst.usedPercent)}% left`;
  tokens[`${base}_status`] =
    `updated ${Math.round((now.getTime() - snapshot.fetchedAt.getTime()) / 60000)}m ago`;
  if (snapshot.plan) tokens[`${base}_plan`] = snapshot.plan;
  if (snapshot.detail) tokens[`${base}_detail`] = snapshot.detail;
  return tokens;
}
