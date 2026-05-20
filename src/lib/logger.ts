import fs from "node:fs/promises";
import path from "node:path";

import { formatTimestamp } from "./utils.js";

interface LoggerEntry {
  timestamp: string;
  level: "info" | "warn" | "error";
  message: string;
  context: Record<string, unknown>;
}

class Logger {
  appLogFile: string;
  eventsLogFile: string;

  constructor({ appLogFile, eventsLogFile }: { appLogFile: string; eventsLogFile: string }) {
    this.appLogFile = appLogFile;
    this.eventsLogFile = eventsLogFile;
  }

  async log(
    level: LoggerEntry["level"],
    message: string,
    context: Record<string, unknown> = {},
  ): Promise<void> {
    const entry: LoggerEntry = {
      timestamp: formatTimestamp(),
      level,
      message,
      context,
    };

    await fs.mkdir(path.dirname(this.appLogFile), { recursive: true });
    await fs.mkdir(path.dirname(this.eventsLogFile), { recursive: true });

    const line = `[${entry.timestamp}] ${level.toUpperCase()} ${message}`;
    const suffix = Object.keys(context).length ? ` ${JSON.stringify(context)}` : "";

    await Promise.all([
      fs.appendFile(this.appLogFile, `${line}${suffix}\n`, "utf8"),
      fs.appendFile(this.eventsLogFile, `${JSON.stringify(entry)}\n`, "utf8"),
    ]);
  }

  info(message: string, context?: Record<string, unknown>): Promise<void> {
    return this.log("info", message, context);
  }

  warn(message: string, context?: Record<string, unknown>): Promise<void> {
    return this.log("warn", message, context);
  }

  error(message: string, context?: Record<string, unknown>): Promise<void> {
    return this.log("error", message, context);
  }
}

export { Logger };
