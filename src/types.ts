export type Window = {
  label: string;
  usedPercent: number;
  resetsAt?: Date;
};

export type ProviderSnapshot = {
  provider: string;
  label: string;
  windows: Window[];
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
  refreshMinutes: number;
};

export const DEFAULT_CONFIG: Config = {
  providers: { claude: true, codex: true },
  refreshMinutes: 5,
};