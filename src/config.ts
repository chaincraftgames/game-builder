let config: Record<string, string> = {
    "design-graph-type": "game-design",
    "simulation-graph-type": "game-simulation",
}

export function getConfig(configKey: string): string {
    return config[configKey];
}

export function setConfig(configKey: string, configValue: string): void {
    config[configKey] = configValue;
}