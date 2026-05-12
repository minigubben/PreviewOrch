const { RepoValidationError } = require("./repo-store");
const { buildPreviewHost, buildProjectName, slugifyRepo } = require("./utils");

class DeploymentService {
  constructor({ config, logger, repoStore, deploymentStore, scriptRunner, lockManager }) {
    this.config = config;
    this.logger = logger;
    this.repoStore = repoStore;
    this.deploymentStore = deploymentStore;
    this.scriptRunner = scriptRunner;
    this.lockManager = lockManager;
  }

  async listDeployments() {
    return this.deploymentStore.listWithLogTails();
  }

  async handleWebhook(webhookContext) {
    if (!webhookContext.mappedAction) {
      await this.logger.info("Ignored pull request webhook action", {
        action: webhookContext.action,
        repoFullName: webhookContext.repoFullName,
      });
      return { ignored: true };
    }

    const repo = await this.repoStore.findByFullName(webhookContext.repoFullName);
    if (!repo || !repo.enabled) {
      await this.logger.warn("Webhook received for unknown or disabled repository", {
        repoFullName: webhookContext.repoFullName,
        prNumber: webhookContext.prNumber,
      });
      return { ignored: true };
    }

    const lockKey = `${repo.id}:${webhookContext.prNumber}`;
    return this.lockManager.run(lockKey, async () => {
      if (webhookContext.mappedAction === "deploy") {
        return this.deployPullRequest({
          repo,
          prNumber: webhookContext.prNumber,
          prBranch: webhookContext.prBranch,
          prSha: webhookContext.prSha,
          sourceCloneSshUrl: webhookContext.sourceCloneSshUrl || repo.cloneSshUrl,
          lastEvent: webhookContext.action,
        });
      }

      return this.destroyPullRequest({
        repo,
        prNumber: webhookContext.prNumber,
        lastEvent: webhookContext.action,
      });
    });
  }

  async redeployById(deploymentId) {
    const metadata = await this.deploymentStore.getById(deploymentId);
    if (!metadata) {
      throw new RepoValidationError("Deployment not found.");
    }

    const repo = await this.repoStore.getById(metadata.repoId);
    if (!repo) {
      throw new RepoValidationError("Repository for deployment no longer exists.");
    }

    return this.lockManager.run(`${repo.id}:${metadata.prNumber}`, async () =>
      this.deployPullRequest({
        repo,
        prNumber: metadata.prNumber,
        prBranch: metadata.prBranch,
        prSha: metadata.prSha,
        sourceCloneSshUrl: metadata.sourceCloneSshUrl || repo.cloneSshUrl,
        lastEvent: "manual-redeploy",
      }),
    );
  }

  async destroyById(deploymentId) {
    const metadata = await this.deploymentStore.getById(deploymentId);
    if (!metadata) {
      return { destroyed: false, alreadyMissing: true };
    }

    const repo = await this.repoStore.getById(metadata.repoId);
    if (!repo) {
      throw new RepoValidationError("Repository for deployment no longer exists.");
    }

    return this.lockManager.run(`${repo.id}:${metadata.prNumber}`, async () =>
      this.destroyPullRequest({
        repo,
        prNumber: metadata.prNumber,
        lastEvent: "manual-destroy",
      }),
    );
  }

  async deployPullRequest({ repo, prNumber, prBranch, prSha, sourceCloneSshUrl, lastEvent }) {
    const repoSlug = repo.slug || slugifyRepo(repo.owner, repo.name);
    const previewHost = buildPreviewHost(repoSlug, prNumber, this.config.baseDomain);
    const projectName = buildProjectName(repoSlug, prNumber);
    const workDir = this.deploymentStore.getWorkDir(repoSlug, prNumber);
    const logFile = this.deploymentStore.getLogPath(repoSlug, prNumber);
    const composePathResolved = `${workDir}/${repo.composePath}`.replace(/\/+/g, "/");
    const now = new Date().toISOString();

    const seed = {
      deploymentId: `${repo.id}-pr-${prNumber}`,
      repoId: repo.id,
      repoSlug,
      prNumber,
      prBranch,
      prSha,
      previewHost,
      projectName,
      workDir,
      composePathResolved,
      sourceCloneSshUrl,
      status: "deploying",
      lastEvent,
      logFile,
      createdAt: now,
      updatedAt: now,
      publicPort: repo.publicPort,
      publicService: repo.publicService,
    };

    const existing = await this.deploymentStore.getById(seed.deploymentId);
    if (existing) {
      seed.createdAt = existing.createdAt;
    }

    await this.deploymentStore.save(seed);
    await this.logger.info("Starting PR deployment", {
      deploymentId: seed.deploymentId,
      repoId: repo.id,
      prNumber,
      lastEvent,
    });

    try {
      const result = await this.scriptRunner.run({
        scriptPath: this.config.scripts.deployPr,
        logFile,
        env: {
          REPO_ID: repo.id,
          REPO_OWNER: repo.owner,
          REPO_NAME: repo.name,
          REPO_SLUG: repoSlug,
          SOURCE_CLONE_SSH_URL: sourceCloneSshUrl,
          DEFAULT_BRANCH: repo.defaultBranch,
          COMPOSE_PATH: repo.composePath,
          PUBLIC_SERVICE: repo.publicService,
          PUBLIC_PORT: String(repo.publicPort),
          PR_NUMBER: String(prNumber),
          PR_BRANCH: prBranch,
          PR_SHA: prSha,
          BASE_DOMAIN: this.config.baseDomain,
          DEPLOYMENTS_DIR: this.config.deploymentsDir,
          LOG_FILE: logFile,
          LAST_EVENT: lastEvent,
          TRAEFIK_NETWORK_NAME: this.config.traefikNetworkName,
          SSH_DIR: this.config.sshDir,
        },
      });

      const finalMetadata = {
        ...seed,
        ...(result.parsed || {}),
        status: "running",
        lastEvent,
        logFile,
        updatedAt: new Date().toISOString(),
      };

      await this.deploymentStore.save(finalMetadata);
      await this.logger.info("PR deployment finished", {
        deploymentId: finalMetadata.deploymentId,
        previewHost: finalMetadata.previewHost,
      });
      return finalMetadata;
    } catch (error) {
      const failed = {
        ...seed,
        status: "failed",
        lastEvent,
        updatedAt: new Date().toISOString(),
        lastError: error.parsed?.message || error.stderr || error.message,
      };
      await this.deploymentStore.save(failed);
      await this.logger.error("PR deployment failed", {
        deploymentId: failed.deploymentId,
        error: failed.lastError,
      });
      throw error;
    }
  }

  async destroyPullRequest({ repo, prNumber, lastEvent }) {
    const repoSlug = repo.slug || slugifyRepo(repo.owner, repo.name);
    const deploymentId = `${repo.id}-pr-${prNumber}`;
    const existing = await this.deploymentStore.getById(deploymentId);
    const previewHost = buildPreviewHost(repoSlug, prNumber, this.config.baseDomain);
    const projectName = buildProjectName(repoSlug, prNumber);
    const workDir = this.deploymentStore.getWorkDir(repoSlug, prNumber);
    const composePathResolved = `${workDir}/${repo.composePath}`.replace(/\/+/g, "/");
    const logFile = this.deploymentStore.getLogPath(repoSlug, prNumber);
    const seed = {
      deploymentId,
      repoId: repo.id,
      repoSlug,
      prNumber,
      prBranch: existing?.prBranch || null,
      prSha: existing?.prSha || null,
      previewHost,
      projectName,
      workDir,
      composePathResolved,
      sourceCloneSshUrl: existing?.sourceCloneSshUrl || repo.cloneSshUrl,
      status: "destroying",
      lastEvent,
      logFile,
      createdAt: existing?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      publicPort: repo.publicPort,
      publicService: repo.publicService,
    };

    await this.deploymentStore.save(seed);
    await this.logger.info("Starting PR destroy", { deploymentId, lastEvent });

    try {
      await this.scriptRunner.run({
        scriptPath: this.config.scripts.destroyPr,
        logFile,
        env: {
          DEPLOYMENT_METADATA_PATH: this.deploymentStore.getMetadataPath(repoSlug, prNumber),
          DEPLOYMENT_ID: deploymentId,
        },
      });
      await this.logger.info("PR destroy finished", { deploymentId });
      return { destroyed: true, deploymentId };
    } catch (error) {
      const failed = {
        ...seed,
        status: "failed",
        updatedAt: new Date().toISOString(),
        lastError: error.parsed?.message || error.stderr || error.message,
      };
      await this.deploymentStore.save(failed);
      await this.logger.error("PR destroy failed", { deploymentId, error: failed.lastError });
      throw error;
    }
  }
}

module.exports = {
  DeploymentService,
};
