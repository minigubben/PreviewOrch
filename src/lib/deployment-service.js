const path = require("path");

const { RepoValidationError } = require("./repo-store");
const { buildDeploymentKey, buildPreviewHost, buildProjectName, slugifyRepo } = require("./utils");

class DeploymentService {
  constructor({ config, logger, repoStore, deploymentStore, scriptRunner, lockManager, runtimeInspector, githubDeploymentPublisher }) {
    this.config = config;
    this.logger = logger;
    this.repoStore = repoStore;
    this.deploymentStore = deploymentStore;
    this.scriptRunner = scriptRunner;
    this.lockManager = lockManager;
    this.runtimeInspector = runtimeInspector;
    this.githubDeploymentPublisher = githubDeploymentPublisher;
  }

  async listDeployments() {
    const deployments = await this.deploymentStore.listWithLogTails();
    if (!this.runtimeInspector) {
      return deployments.map((deployment) => ({
        ...deployment,
        runtime: {
          available: false,
          status: "unavailable",
          reason: "runtime-inspector-disabled",
          containers: [],
          publicServiceContainer: null,
        },
      }));
    }

    return Promise.all(
      deployments.map(async (deployment) => ({
        ...deployment,
        runtime: await this.runtimeInspector.inspectDeployment(deployment),
      })),
    );
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

    const deploymentKey = buildDeploymentKey("pr", webhookContext.prNumber);
    const lockKey = `${repo.id}:${deploymentKey}`;
    const task = async () => {
      if (webhookContext.mappedAction === "deploy") {
        return this.deployTarget({
          repo,
          targetType: "pr",
          targetValue: webhookContext.prNumber,
          targetBranch: webhookContext.prBranch,
          targetSha: webhookContext.prSha,
          sourceCloneSshUrl: webhookContext.sourceCloneSshUrl || repo.cloneSshUrl,
          lastEvent: webhookContext.action,
        });
      }

      return this.destroyTarget({
        repo,
        deploymentKey,
        lastEvent: webhookContext.action,
      });
    };

    this.lockManager.run(lockKey, task).catch(async (error) => {
      await this.logger.error("Queued webhook deployment failed", {
        repoId: repo.id,
        deploymentKey,
        action: webhookContext.action,
        message: error.message,
      });
    });

    await this.logger.info("Queued webhook deployment", {
      repoId: repo.id,
      deploymentKey,
      action: webhookContext.action,
    });

    return {
      accepted: true,
      queued: true,
      repoId: repo.id,
      deploymentKey,
      action: webhookContext.action,
    };
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

    return this.lockManager.run(`${repo.id}:${metadata.deploymentKey}`, async () =>
      this.deployTarget({
        repo,
        targetType: metadata.targetType || "pr",
        targetValue: metadata.targetValue ?? metadata.prNumber,
        targetBranch: metadata.targetBranch || metadata.prBranch,
        targetSha: metadata.targetSha || metadata.prSha,
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

    return this.lockManager.run(`${repo.id}:${metadata.deploymentKey}`, async () =>
      this.destroyTarget({
        repo,
        deploymentKey: metadata.deploymentKey,
        lastEvent: "manual-destroy",
      }),
    );
  }

  async deployManualTarget({ repoId, manualTargetType, manualTargetValue }) {
    const repo = await this.repoStore.getById(repoId);
    if (!repo) {
      throw new RepoValidationError("Repository not found.");
    }
    if (!repo.enabled) {
      throw new RepoValidationError("Repository is disabled.");
    }

    const targetType = normalizeManualTargetType(manualTargetType);
    const targetValue = normalizeManualTargetValue(targetType, manualTargetValue);
    const deploymentKey = buildDeploymentKey(targetType, targetValue);
    const targetBranch = targetType === "branch" ? targetValue : null;

    return this.lockManager.run(`${repo.id}:${deploymentKey}`, async () =>
      this.deployTarget({
        repo,
        targetType,
        targetValue,
        targetBranch,
        targetSha: null,
        sourceCloneSshUrl: repo.cloneSshUrl,
        lastEvent: "manual-deploy",
      }),
    );
  }

  async deployTarget({ repo, targetType, targetValue, targetBranch, targetSha, sourceCloneSshUrl, lastEvent }) {
    const repoSlug = repo.slug || slugifyRepo(repo.owner, repo.name);
    const deploymentKey = buildDeploymentKey(targetType, targetValue);
    const previewHost = buildPreviewHost(repoSlug, deploymentKey, this.config.baseDomain);
    const projectName = buildProjectName(repoSlug, deploymentKey);
    const workDir = this.deploymentStore.getWorkDir(repoSlug, deploymentKey);
    const projectDirectoryResolved = path.resolve(workDir, repo.workingDirectory || ".");
    const logFile = this.deploymentStore.getLogPath(repoSlug, deploymentKey);
    const composePathResolved = path.resolve(projectDirectoryResolved, repo.composePath);
    const now = new Date().toISOString();
    const existing = await this.deploymentStore.getById(`${repo.id}-${deploymentKey}`);

    const seed = {
      deploymentId: `${repo.id}-${deploymentKey}`,
      deploymentKey,
      repoId: repo.id,
      repoSlug,
      targetType,
      targetValue,
      targetBranch,
      targetSha,
      prNumber: targetType === "pr" ? Number(targetValue) : null,
      prBranch: targetType === "pr" ? targetBranch : null,
      prSha: targetType === "pr" ? targetSha : null,
      previewHost,
      projectName,
      workDir,
      workingDirectory: repo.workingDirectory || ".",
      projectDirectoryResolved,
      composePathResolved,
      sourceCloneSshUrl,
      status: "deploying",
      lastEvent,
      logFile,
      createdAt: now,
      updatedAt: now,
      publicPort: repo.publicPort,
      publicService: repo.publicService,
      appendProxySettings: repo.appendProxySettings,
      previewHostEnvVarName: repo.previewHostEnvVarName || "",
      extraEnv: repo.extraEnv || {},
      githubDeployment: existing?.githubDeployment || null,
    };

    if (existing) {
      seed.createdAt = existing.createdAt;
    }

    await this.deploymentStore.save(seed);
    await this.logger.info("Starting deployment", {
      deploymentId: seed.deploymentId,
      repoId: repo.id,
      deploymentKey,
      lastEvent,
    });

    const githubDeployment = await this.createGithubDeployment(repo, seed);
    if (githubDeployment) {
      seed.githubDeployment = githubDeployment;
      seed.updatedAt = new Date().toISOString();
      await this.deploymentStore.save(seed);
    }

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
          WORKING_DIRECTORY: repo.workingDirectory || ".",
          COMPOSE_PATH: repo.composePath,
          PUBLIC_SERVICE: repo.publicService,
          PUBLIC_PORT: String(repo.publicPort),
          APPEND_PROXY_SETTINGS: String(repo.appendProxySettings),
          PREVIEW_HOST_ENV_VAR_NAME: repo.previewHostEnvVarName || "",
          EXTRA_ENV_JSON: JSON.stringify(repo.extraEnv || {}),
          DEPLOYMENT_KEY: deploymentKey,
          TARGET_TYPE: targetType,
          TARGET_VALUE: String(targetValue),
          TARGET_BRANCH: targetBranch || "",
          TARGET_SHA: targetSha || "",
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
      await this.publishGithubDeploymentStatus(repo, finalMetadata, {
        state: "success",
        description: "Preview deployment is ready.",
        autoInactive: true,
      });
      await this.logger.info("Deployment finished", {
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
      await this.publishGithubDeploymentStatus(repo, failed, {
        state: "failure",
        description: failed.lastError || "Preview deployment failed.",
        autoInactive: false,
      });
      await this.logger.error("Deployment failed", {
        deploymentId: failed.deploymentId,
        error: failed.lastError,
      });
      throw error;
    }
  }

  async destroyTarget({ repo, deploymentKey, lastEvent }) {
    const repoSlug = repo.slug || slugifyRepo(repo.owner, repo.name);
    const deploymentId = `${repo.id}-${deploymentKey}`;
    const existing = await this.deploymentStore.getById(deploymentId);
    const previewHost = buildPreviewHost(repoSlug, deploymentKey, this.config.baseDomain);
    const projectName = buildProjectName(repoSlug, deploymentKey);
    const workDir = this.deploymentStore.getWorkDir(repoSlug, deploymentKey);
    const projectDirectoryResolved = existing?.projectDirectoryResolved || path.resolve(workDir, repo.workingDirectory || ".");
    const composePathResolved = existing?.composePathResolved || path.resolve(projectDirectoryResolved, repo.composePath);
    const logFile = this.deploymentStore.getLogPath(repoSlug, deploymentKey);
    const seed = {
      deploymentId,
      deploymentKey,
      repoId: repo.id,
      repoSlug,
      targetType: existing?.targetType || "pr",
      targetValue: existing?.targetValue ?? existing?.prNumber ?? null,
      targetBranch: existing?.targetBranch || existing?.prBranch || null,
      targetSha: existing?.targetSha || existing?.prSha || null,
      prNumber: existing?.prNumber || null,
      prBranch: existing?.prBranch || null,
      prSha: existing?.prSha || null,
      previewHost,
      projectName,
      workDir,
      workingDirectory: existing?.workingDirectory || repo.workingDirectory || ".",
      projectDirectoryResolved,
      composePathResolved,
      sourceCloneSshUrl: existing?.sourceCloneSshUrl || repo.cloneSshUrl,
      status: "destroying",
      lastEvent,
      logFile,
      createdAt: existing?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      publicPort: repo.publicPort,
      publicService: repo.publicService,
      appendProxySettings: repo.appendProxySettings,
      previewHostEnvVarName: repo.previewHostEnvVarName || "",
      extraEnv: repo.extraEnv || {},
      githubDeployment: existing?.githubDeployment || null,
    };

    await this.deploymentStore.save(seed);
    await this.logger.info("Starting destroy", { deploymentId, lastEvent });

    try {
      await this.scriptRunner.run({
        scriptPath: this.config.scripts.destroyPr,
        logFile,
        env: {
          DEPLOYMENT_METADATA_PATH: this.deploymentStore.getMetadataPath(repoSlug, deploymentKey),
          DEPLOYMENT_ID: deploymentId,
        },
      });
      await this.publishGithubDeploymentStatus(repo, seed, {
        state: "inactive",
        description: "Preview deployment was destroyed.",
        autoInactive: false,
      });
      await this.logger.info("Destroy finished", { deploymentId });
      return { destroyed: true, deploymentId };
    } catch (error) {
      const failed = {
        ...seed,
        status: "failed",
        updatedAt: new Date().toISOString(),
        lastError: error.parsed?.message || error.stderr || error.message,
      };
      await this.deploymentStore.save(failed);
      await this.logger.error("Destroy failed", { deploymentId, error: failed.lastError });
      throw error;
    }
  }

  async createGithubDeployment(repo, metadata) {
    if (!this.githubDeploymentPublisher?.isEnabled()) {
      return null;
    }

    const ref = buildGithubDeploymentRef(metadata);
    if (!ref) {
      await this.logger.warn("Skipping GitHub deployment publish because no ref could be derived", {
        deploymentId: metadata.deploymentId,
      });
      return null;
    }

    const environment = buildGithubEnvironmentName(metadata);
    const description = buildGithubDeploymentDescription(metadata);

    try {
      const deployment = await this.githubDeploymentPublisher.createDeployment({
        owner: repo.owner,
        repo: repo.name,
        ref,
        environment,
        description,
        payload: {
          deploymentId: metadata.deploymentId,
          deploymentKey: metadata.deploymentKey,
          previewHost: metadata.previewHost,
          targetType: metadata.targetType,
          targetValue: metadata.targetValue,
        },
      });

      const githubDeployment = {
        id: deployment.id,
        owner: repo.owner,
        repo: repo.name,
        environment,
        ref,
        statusesUrl: deployment.statuses_url || "",
      };

      await this.publishGithubDeploymentStatus(repo, { ...metadata, githubDeployment }, {
        state: "pending",
        description: "Preview deployment is starting.",
        autoInactive: false,
      });

      return githubDeployment;
    } catch (error) {
      await this.logger.warn("GitHub deployment publish failed", {
        deploymentId: metadata.deploymentId,
        message: error.message,
      });
      return null;
    }
  }

  async publishGithubDeploymentStatus(repo, metadata, { state, description, autoInactive }) {
    if (!this.githubDeploymentPublisher?.isEnabled() || !metadata.githubDeployment?.id) {
      return;
    }

    try {
      await this.githubDeploymentPublisher.createDeploymentStatus({
        owner: repo.owner,
        repo: repo.name,
        deploymentId: metadata.githubDeployment.id,
        state,
        environment: metadata.githubDeployment.environment || buildGithubEnvironmentName(metadata),
        environmentUrl:
          state === "inactive" ? undefined : `http://${metadata.previewHost}`,
        logUrl: this.githubDeploymentPublisher.buildLogUrl(metadata.deploymentId),
        description,
        autoInactive,
      });
    } catch (error) {
      await this.logger.warn("GitHub deployment status publish failed", {
        deploymentId: metadata.deploymentId,
        githubDeploymentId: metadata.githubDeployment.id,
        state,
        message: error.message,
      });
    }
  }
}

function normalizeManualTargetType(value) {
  const normalized = String(value || "").toLowerCase();
  if (normalized === "branch" || normalized === "pr") {
    return normalized;
  }
  throw new RepoValidationError("manualTargetType must be 'branch' or 'pr'.");
}

function normalizeManualTargetValue(targetType, value) {
  if (targetType === "pr") {
    const prNumber = Number(value);
    if (!Number.isInteger(prNumber) || prNumber <= 0) {
      throw new RepoValidationError("Manual PR deployments require a positive PR number.");
    }
    return prNumber;
  }

  const branch = String(value || "").trim();
  if (!branch) {
    throw new RepoValidationError("Manual branch deployments require a branch name.");
  }
  return branch;
}

function buildGithubDeploymentRef(metadata) {
  if (metadata.targetType === "pr" && metadata.targetValue) {
    return `refs/pull/${metadata.targetValue}/head`;
  }

  return metadata.targetSha || metadata.targetBranch || String(metadata.targetValue || "").trim() || null;
}

function buildGithubEnvironmentName(metadata) {
  return `preview/${metadata.deploymentKey}`;
}

function buildGithubDeploymentDescription(metadata) {
  if (metadata.targetType === "pr") {
    return `Preview deployment for PR #${metadata.targetValue}`;
  }

  return `Preview deployment for branch ${metadata.targetValue}`;
}

module.exports = {
  DeploymentService,
};
