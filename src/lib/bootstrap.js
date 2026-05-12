const fs = require("fs/promises");

const { readJson, writeJson } = require("./json-file");
const { formatTimestamp } = require("./utils");

async function ensureFile(filePath, fallback) {
  const existing = await readJson(filePath, undefined);
  if (existing === undefined) {
    await writeJson(filePath, fallback);
  }
}

async function bootstrapFilesystem(config) {
  await fs.mkdir(config.configDir, { recursive: true });
  await fs.mkdir(config.deploymentsDir, { recursive: true });
  await fs.mkdir(config.logsDir, { recursive: true });
  await fs.mkdir(config.deploymentLogsDir, { recursive: true });
  await fs.mkdir(config.sshDir, { recursive: true });

  await ensureFile(config.reposFile, []);
  await ensureFile(config.settingsFile, {
    createdAt: formatTimestamp(),
    baseDomain: config.baseDomain,
    traefikNetworkName: config.traefikNetworkName,
  });
}

module.exports = {
  bootstrapFilesystem,
};
