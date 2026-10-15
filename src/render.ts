import type { ProviderSnapshot, Window } from "./types.ts";

const BAR_CELLS = 8;

/** The only window shown. Both providers' weekly windows are labelled this. */
const WEEKLY_LABEL = "wk";

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

/** Highest-pressure window, used for the compact one-line variant. */
export function headroom(snapshot: ProviderSnapshot): Window | undefined {
  return snapshot.windows.reduce<Window | undefined>(
    (worst, window) => (worst === undefined || window.usedPercent > worst.usedPercent ? window : worst),
    undefined,
  );
}

/** `claude wk ████░░░░ 46% 3d`, or `claude wk n/a` when the provider has no weekly window. */
function formatProvider(snapshot: ProviderSnapshot, now: Date): string {
  if (snapshot.provider === "kataleptic") {
    return snapshot.spendUsd === undefined ? "kataleptic n/a" : `kataleptic $${snapshot.spendUsd.toFixed(2)} today`;
  }
  const weekly = snapshot.windows.find((window) => window.label === WEEKLY_LABEL);
  if (!weekly) return `${snapshot.provider} ${WEEKLY_LABEL} n/a`;
  return `${snapshot.provider} ${WEEKLY_LABEL} ${formatBar(weekly.usedPercent)} ${Math.round(weekly.usedPercent)}%${formatReset(weekly.resetsAt, now)}`;
}

/** One status line with every provider's weekly quota; Herdr shows only the last line of output. */
export function statusLine(snapshots: ProviderSnapshot[], now: Date): string {
  if (snapshots.length === 0) return "quota n/a";
  return snapshots.map((snapshot) => formatProvider(snapshot, now)).join("  ");
}
