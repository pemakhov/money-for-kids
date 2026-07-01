export interface AppConfig {
  repoPath: string;
  nodePath: string | null;
  autoStartServerOnLaunch: boolean;
  openAtLogin: boolean;
}

export interface ConfigIO {
  read(): string | null;
  write(text: string): void;
}

export function defaultConfig(repoPath: string): AppConfig {
  return {
    repoPath,
    nodePath: null,
    autoStartServerOnLaunch: true,
    openAtLogin: true,
  };
}

export function loadConfig(io: ConfigIO, defaults: AppConfig): AppConfig {
  const raw = io.read();
  if (raw === null) {
    io.write(JSON.stringify(defaults, null, 2));
    return defaults;
  }
  let parsed: Partial<AppConfig> = {};
  try {
    parsed = JSON.parse(raw) as Partial<AppConfig>;
  } catch {
    parsed = {};
  }
  const merged: AppConfig = {
    repoPath: parsed.repoPath ?? defaults.repoPath,
    nodePath: parsed.nodePath ?? defaults.nodePath,
    autoStartServerOnLaunch: parsed.autoStartServerOnLaunch ?? defaults.autoStartServerOnLaunch,
    openAtLogin: parsed.openAtLogin ?? defaults.openAtLogin,
  };
  io.write(JSON.stringify(merged, null, 2));
  return merged;
}
