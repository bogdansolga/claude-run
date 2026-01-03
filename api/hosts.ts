import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { execFileSync } from "child_process";

export interface HostConfig {
  id: string;
  label: string;
  type: "local" | "ssh";
  host?: string; // for SSH
  user?: string; // for SSH
  default?: boolean;
}

export interface Config {
  hosts: Record<string, Omit<HostConfig, "id">>;
  defaultHost?: string;
}

export interface HostInfo extends HostConfig {
  status: "online" | "offline" | "unknown";
}

const CONFIG_PATH = join(homedir(), ".claude-run", "config.json");

// Detect if running in Docker container
const IS_DOCKER = process.env.CLAUDE_RUN_DOCKER === "true";

/**
 * Validate and sanitize host configuration
 * Returns null if the configuration is invalid
 */
function validateHostConfig(id: string, host: any): HostConfig | null {
  if (!host.label || typeof host.label !== "string") return null;
  if (host.type !== "local" && host.type !== "ssh") return null;
  if (host.type === "ssh") {
    if (!host.host || !host.user) return null;
    // Validate host/user don't contain dangerous characters
    if (!/^[a-zA-Z0-9._-]+$/.test(host.host)) return null;
    if (!/^[a-zA-Z0-9._-]+$/.test(host.user)) return null;
  }
  return { id, ...host } as HostConfig;
}

// Default local host configuration
const DEFAULT_LOCAL_HOST: HostConfig = {
  id: "local",
  label: "Local",
  type: "local",
  default: true,
};

/**
 * Generate default configuration based on environment
 * - Docker (running on Pi): PiNAS local, MacStudio remote (default)
 * - Dev (running on MacStudio): MacStudio local (default)
 */
function getDefaultConfig(): Config {
  if (IS_DOCKER) {
    // Running in Docker on PiNAS - prefer MacStudio via SSH
    return {
      hosts: {
        macstudio: {
          label: "MacStudio",
          type: "ssh",
          host: "192.168.1.5",
          user: "bogdan",
          default: true,
        },
        local: {
          label: "PiNAS (local)",
          type: "local",
        },
      },
      defaultHost: "macstudio",
    };
  } else {
    // Running in dev mode - local is default
    return {
      hosts: {
        local: {
          label: "Local",
          type: "local",
          default: true,
        },
      },
      defaultHost: "local",
    };
  }
}

/**
 * Load configuration from ~/.claude-run/config.json
 * Falls back to environment-specific defaults if no config exists
 */
export function loadConfig(): Config {
  if (!existsSync(CONFIG_PATH)) {
    return getDefaultConfig();
  }

  try {
    const content = readFileSync(CONFIG_PATH, "utf-8");
    const config = JSON.parse(content) as Config;
    return config;
  } catch (error) {
    console.error("Failed to parse config file:", error);
    return getDefaultConfig();
  }
}

/**
 * Get all configured hosts
 */
export function getHosts(): HostConfig[] {
  const config = loadConfig();

  return Object.entries(config.hosts)
    .map(([id, hostConfig]) => validateHostConfig(id, hostConfig))
    .filter((host): host is HostConfig => host !== null);
}

/**
 * Get the default host configuration
 */
export function getDefaultHost(): HostConfig {
  const config = loadConfig();
  const hosts = getHosts();

  // First check for explicit defaultHost setting
  if (config.defaultHost) {
    const host = hosts.find((h) => h.id === config.defaultHost);
    if (host) return host;
  }

  // Then check for host with default: true
  const defaultHost = hosts.find((h) => h.default === true);
  if (defaultHost) return defaultHost;

  // Fall back to first host or local
  return hosts[0] || DEFAULT_LOCAL_HOST;
}

/**
 * Get a specific host by ID
 */
export function getHost(id: string): HostConfig | undefined {
  const hosts = getHosts();
  return hosts.find((h) => h.id === id);
}

/**
 * Check if an SSH host is online
 * Returns true if connection succeeds, false otherwise
 */
export async function checkHostOnline(host: HostConfig): Promise<boolean> {
  if (host.type === "local") {
    return true;
  }

  if (host.type === "ssh" && host.host && host.user) {
    try {
      // Try to connect with a short timeout
      // Use execFileSync with array arguments to prevent command injection
      execFileSync("ssh", [
        "-o", "ConnectTimeout=2",
        "-o", "BatchMode=yes",
        `${host.user}@${host.host}`,
        "echo ok"
      ], { timeout: 5000, stdio: "pipe" });
      return true;
    } catch {
      return false;
    }
  }

  return false;
}

/**
 * Get all hosts with their online status
 */
export async function getHostsWithStatus(): Promise<HostInfo[]> {
  const hosts = getHosts();

  const hostsWithStatus = await Promise.all(
    hosts.map(async (host) => {
      const online = await checkHostOnline(host);
      return {
        ...host,
        status: online ? "online" : "offline",
      } as HostInfo;
    })
  );

  return hostsWithStatus;
}
