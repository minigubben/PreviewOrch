const fs = require("fs/promises");
const path = require("path");

const { readJson, writeJson } = require("./json-file");
const { readLogTail } = require("./log-reader");

class DeploymentStore {
  constructor({ deploymentsDir, deploymentLogsDir }) {
    this.deploymentsDir = deploymentsDir;
    this.deploymentLogsDir = deploymentLogsDir;
  }

  getWorkDir(repoSlug, prNumber) {
    return path.join(this.deploymentsDir, repoSlug, `pr-${prNumber}`);
  }

  getMetadataPath(repoSlug, prNumber) {
    return path.join(this.getWorkDir(repoSlug, prNumber), "deployment.json");
  }

  getLogPath(repoSlug, prNumber) {
    return path.join(this.deploymentLogsDir, `${repoSlug}-pr-${prNumber}.log`);
  }

  async save(metadata) {
    await writeJson(this.getMetadataPath(metadata.repoSlug, metadata.prNumber), metadata);
    return metadata;
  }

  async getById(deploymentId) {
    const deployments = await this.list();
    return deployments.find((deployment) => deployment.deploymentId === deploymentId) || null;
  }

  async list() {
    const deployments = [];

    const repoEntries = await safeReadDir(this.deploymentsDir);
    for (const repoEntry of repoEntries) {
      if (!repoEntry.isDirectory()) {
        continue;
      }

      const prEntries = await safeReadDir(path.join(this.deploymentsDir, repoEntry.name));
      for (const prEntry of prEntries) {
        if (!prEntry.isDirectory()) {
          continue;
        }

        const metadata = await readJson(path.join(this.deploymentsDir, repoEntry.name, prEntry.name, "deployment.json"), null);
        if (metadata) {
          deployments.push(metadata);
        }
      }
    }

    return deployments.sort((left, right) => {
      const rightDate = new Date(right.updatedAt || right.createdAt || 0).getTime();
      const leftDate = new Date(left.updatedAt || left.createdAt || 0).getTime();
      return rightDate - leftDate;
    });
  }

  async listWithLogTails(maxLines = 40) {
    const deployments = await this.list();
    return Promise.all(
      deployments.map(async (deployment) => ({
        ...deployment,
        logTail: await readLogTail(this.getLogPath(deployment.repoSlug, deployment.prNumber), maxLines),
      })),
    );
  }
}

async function safeReadDir(directory) {
  try {
    return await fs.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

module.exports = {
  DeploymentStore,
};
