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
 * Check if running in Docker environment
 */
export function isDocker(): boolean {
  return IS_DOCKER;
}

/**
 * Get SSH key path from environment or default for Docker
 */
export function getSSHKeyPath(): string | undefined {
  if (process.env.CLAUDE_RUN_SSH_KEY) {
    return process.env.CLAUDE_RUN_SSH_KEY;
  }
  if (IS_DOCKER) {
    return process.env.CLAUDE_RUN_SSH_KEY || "/home/claude-run/.ssh/id_rsa";
  }
  return undefined; // Use system default
}

/**
 * Get SSH known_hosts path from environment or default for Docker
 */
export function getSSHKnownHostsPath(): string | undefined {
  if (process.env.CLAUDE_RUN_SSH_KNOWN_HOSTS) {
    return process.env.CLAUDE_RUN_SSH_KNOWN_HOSTS;
  }
  if (IS_DOCKER) {
    return process.env.CLAUDE_RUN_SSH_KNOWN_HOSTS || "/home/claude-run/.ssh/known_hosts";
  }
  return undefined; // Use system default
}

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
 * Generate default configuration based on environment variables
 * Configure hosts via environment:
 * - CLAUDE_RUN_HOST_PRIMARY_LABEL, CLAUDE_RUN_HOST_PRIMARY_TYPE, CLAUDE_RUN_HOST_PRIMARY_HOST, CLAUDE_RUN_HOST_PRIMARY_USER
 * - CLAUDE_RUN_HOST_SECONDARY_LABEL, CLAUDE_RUN_HOST_SECONDARY_TYPE, CLAUDE_RUN_HOST_SECONDARY_HOST, CLAUDE_RUN_HOST_SECONDARY_USER
 * - CLAUDE_RUN_DEFAULT_HOST (which host ID to use as default)
 */
function getDefaultConfig(): Config {
  const hosts: Record<string, Omit<HostConfig, "id">> = {};

  // Always include local host for non-Docker environments
  if (!IS_DOCKER) {
    hosts.local = {
      label: "Local",
      type: "local",
      default: true,
    };
  }

  // Primary host from environment (e.g., PiNAS in production)
  if (process.env.CLAUDE_RUN_HOST_PRIMARY_LABEL) {
    const hostType = process.env.CLAUDE_RUN_HOST_PRIMARY_TYPE as "local" | "ssh" || "ssh";
    hosts.primary = {
      label: process.env.CLAUDE_RUN_HOST_PRIMARY_LABEL,
      type: hostType,
      ...(hostType === "ssh" && {
        host: process.env.CLAUDE_RUN_HOST_PRIMARY_HOST,
        user: process.env.CLAUDE_RUN_HOST_PRIMARY_USER,
      }),
      default: process.env.CLAUDE_RUN_DEFAULT_HOST === "primary" || IS_DOCKER,
    };
  }

  // Secondary host from environment (e.g., MacStudio in production)
  if (process.env.CLAUDE_RUN_HOST_SECONDARY_LABEL) {
    const hostType = process.env.CLAUDE_RUN_HOST_SECONDARY_TYPE as "local" | "ssh" || "ssh";
    hosts.secondary = {
      label: process.env.CLAUDE_RUN_HOST_SECONDARY_LABEL,
      type: hostType,
      ...(hostType === "ssh" && {
        host: process.env.CLAUDE_RUN_HOST_SECONDARY_HOST,
        user: process.env.CLAUDE_RUN_HOST_SECONDARY_USER,
      }),
      default: process.env.CLAUDE_RUN_DEFAULT_HOST === "secondary",
    };
  }

  // Determine default host
  let defaultHost = process.env.CLAUDE_RUN_DEFAULT_HOST || "local";
  if (IS_DOCKER && !hosts[defaultHost]) {
    defaultHost = "primary";
  }

  return { hosts, defaultHost };
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
      const sshArgs = [
        "-o", "ConnectTimeout=2",
        "-o", "BatchMode=yes",
        "-o", "StrictHostKeyChecking=accept-new",
      ];

      // Add SSH key paths only when configured
      const knownHostsPath = getSSHKnownHostsPath();
      const keyPath = getSSHKeyPath();
      if (knownHostsPath) {
        sshArgs.push("-o", `UserKnownHostsFile=${knownHostsPath}`);
      }
      if (keyPath) {
        sshArgs.push("-o", `IdentityFile=${keyPath}`);
      }

      sshArgs.push(`${host.user}@${host.host}`, "echo ok");

      const execEnv: Record<string, string> = { ...process.env as Record<string, string> };
      if (IS_DOCKER) {
        execEnv.HOME = process.env.CLAUDE_RUN_SSH_HOME || "/home/claude-run";
      }

      execFileSync("ssh", sshArgs, { timeout: 5000, stdio: "pipe", env: execEnv });
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
