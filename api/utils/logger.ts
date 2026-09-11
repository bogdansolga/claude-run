/**
 * Logger utility for colored console output with timestamps.
 * Adapted from finances-manager's shared server logger.
 */
export class Logger {
  readonly colors = {
    blue: "\x1b[34m",
    cyan: "\x1b[36m",
    dim: "\x1b[2m",
    gray: "\x1b[90m",
    green: "\x1b[32m",
    orange: "\x1b[38;5;208m",
    red: "\x1b[31m",
    reset: "\x1b[0m",
    yellow: "\x1b[33m",
  };

  private readonly debugLevel: string;

  constructor() {
    this.debugLevel = process.env.DEBUG_LEVEL || "info";
  }

  private shouldLog(level: string): boolean {
    const levels: Record<string, number> = { debug: 0, info: 1, warn: 2, error: 3 };
    return levels[level] >= levels[this.debugLevel];
  }

  private getTimestamp(): string {
    return `[${new Date().toISOString()}]`;
  }

  private formatMessage(message: string, color: string): string {
    return `${this.getTimestamp()} ${color}${message}${this.colors.reset}`;
  }

  private serializeParameter(parameter: unknown): string {
    if (parameter instanceof Error) return parameter.stack || parameter.message;
    if (typeof parameter === "string") return parameter;
    try {
      return JSON.stringify(parameter, null, 2);
    } catch {
      return String(parameter);
    }
  }

  info(message: string): void {
    if (this.shouldLog("info")) console.info(this.formatMessage(message, this.colors.green));
  }

  debug(message: string): void {
    if (this.shouldLog("debug")) console.debug(this.formatMessage(message, this.colors.dim));
  }

  warn(message: string, parameter?: unknown): void {
    console.warn(this.formatMessage(message, this.colors.orange));
    if (parameter !== undefined) console.warn(this.serializeParameter(parameter));
  }

  error(message: string, error?: unknown): void {
    console.error(this.formatMessage(message, this.colors.red));
    if (error !== undefined) console.error(this.serializeParameter(error));
  }
}

export const logger = new Logger();
