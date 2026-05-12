// @ts-nocheck
import fs from "node:fs/promises";
import path from "node:path";

import { formatTimestamp } from "./utils.js";

class Logger {
  constructor({ appLogFile, eventsLogFile }) {
    this.appLogFile = appLogFile;
    this.eventsLogFile = eventsLogFile;
  }

  async log(level, message, context = {}) {
    const entry = {
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

  info(message, context) {
    return this.log("info", message, context);
  }

  warn(message, context) {
    return this.log("warn", message, context);
  }

  error(message, context) {
    return this.log("error", message, context);
  }
}

export {
  Logger,
};
