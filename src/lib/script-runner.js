const fs = require("fs/promises");
const path = require("path");
const { spawn } = require("child_process");

class ScriptError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "ScriptError";
    Object.assign(this, details);
  }
}

class ScriptRunner {
  constructor({ logger }) {
    this.logger = logger;
  }

  async run({ scriptPath, env = {}, logFile = null, cwd = process.cwd() }) {
    await this.logger.info("Running script", { scriptPath, cwd, logFile });

    if (logFile) {
      await fs.mkdir(path.dirname(logFile), { recursive: true });
      await fs.appendFile(logFile, `\n[script-start] ${new Date().toISOString()} ${scriptPath}\n`, "utf8");
    }

    return new Promise((resolve, reject) => {
      const child = spawn(scriptPath, {
        cwd,
        env: {
          ...process.env,
          ...env,
        },
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";

      const appendLog = async (chunk) => {
        if (!logFile) {
          return;
        }
        await fs.appendFile(logFile, chunk, "utf8");
      };

      child.stdout.on("data", (chunk) => {
        const text = chunk.toString();
        stdout += text;
        void appendLog(text);
      });

      child.stderr.on("data", (chunk) => {
        const text = chunk.toString();
        stderr += text;
        void appendLog(text);
      });

      child.on("error", (error) => {
        reject(new ScriptError(`Unable to run ${scriptPath}`, { cause: error }));
      });

      child.on("close", (code) => {
        const result = {
          code,
          stdout,
          stderr,
          parsed: parseTrailingJson(stdout),
        };

        if (code === 0) {
          resolve(result);
          return;
        }

        reject(
          new ScriptError(`Script failed: ${scriptPath}`, {
            ...result,
          }),
        );
      });
    });
  }

  async checkCommand(command, args = []) {
    return new Promise((resolve) => {
      const child = spawn(command, args, {
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
      });

      child.on("close", (code) => {
        resolve(code === 0);
      });
      child.on("error", () => resolve(false));
    });
  }
}

function parseTrailingJson(stdout) {
  const lines = String(stdout || "")
    .trim()
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (!lines.length) {
    return null;
  }

  const last = lines.at(-1);
  try {
    return JSON.parse(last);
  } catch {
    return null;
  }
}

module.exports = {
  ScriptError,
  ScriptRunner,
};
