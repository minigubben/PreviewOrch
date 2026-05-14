// @ts-nocheck
import fs from "node:fs/promises";

import { readJson, writeJson } from "./json-file.js";
import { formatTimestamp } from "./utils.js";

async function ensureFile(filePath, fallback) {
  const existing = await readJson(filePath, undefined);
  if (existing === undefined) {
    await writeJson(filePath, fallback);
  }
}

async function syncSettingsFile(config) {
  const existing = await readJson(config.settingsFile, null);
  const createdAt = existing?.createdAt || formatTimestamp();

  await writeJson(config.settingsFile, {
    createdAt,
    updatedAt: formatTimestamp(),
    baseDomain: config.baseDomain,
    orchestratorPublicUrl: config.orchestratorPublicUrl,
    traefikNetworkName: config.traefikNetworkName,
    sourceOfTruth: "environment",
  });
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
