// @ts-nocheck
import fs from "node:fs/promises";

import { GithubAppStore } from "./github-app-store.js";

async function ensureFile(filePath, fallback) {
  const { readJson, writeJson } = await import("./json-file.js");
  const existing = await readJson(filePath, undefined);
  if (existing === undefined) {
    await writeJson(filePath, fallback);
  }
}

async function syncSettingsFile(config) {
  const githubAppStore = new GithubAppStore({ settingsFile: config.settingsFile });
  await githubAppStore.syncEnvironment(config);
}

async function bootstrapFilesystem(config) {
  await fs.mkdir(config.configDir, { recursive: true });
  await fs.mkdir(config.deploymentsDir, { recursive: true });
  await fs.mkdir(config.logsDir, { recursive: true });
  await fs.mkdir(config.deploymentLogsDir, { recursive: true });
  await fs.mkdir(config.sshDir, { recursive: true });

  await ensureFile(config.reposFile, []);
  await syncSettingsFile(config);
}

export { bootstrapFilesystem };
