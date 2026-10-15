export type Window = {
  label: string;
  usedPercent: number;
  resetsAt?: Date;
};

export type ProviderSnapshot = {
  provider: string;
  label: string;
  windows: Window[];
  /** Dollars spent so far in the current UTC day; set by the Kataleptic provider only. */
  spendUsd?: number;
  plan?: string;
  detail?: string;
  error?: string;
  fetchedAt: Date;
};

export type Config = {
  providers: {
    claude: boolean;
    codex: boolean;
  };
  /** Shell command that prints the Kataleptic API key; the provider is off while empty. */
  kataleptic: { keyCommand: string };
  refreshMinutes: number;
};

export const DEFAULT_CONFIG: Config = {
  providers: { claude: true, codex: true },
  kataleptic: { keyCommand: "" },
  refreshMinutes: 5,
};