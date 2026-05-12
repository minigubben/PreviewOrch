// @ts-nocheck
import { buildGithubDeploymentDescription, buildGithubDeploymentRef, buildGithubEnvironmentName } from "./github-deployment-metadata.js";
import { buildDeploySeed, buildDestroySeed } from "./deployment-metadata.js";
import { buildDeployScriptEnv, buildDestroyScriptEnv } from "./deployment-script-env.js";
import { RepoValidationError } from "./repo-validation-error.js";
import { buildDeploymentKey } from "./utils.js";

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
        runtime: unavailableRuntime("runtime-inspector-disabled"),
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

    this.runWithDeploymentLock(repo, deploymentKey, task).catch(async (error) => {
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

    const repo = await this.resolveRepoForDeployment(metadata);
    return this.runWithDeploymentLock(repo, metadata.deploymentKey, async () =>
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

    const repo = await this.resolveRepoForDeployment(metadata);
    return this.runWithDeploymentLock(repo, metadata.deploymentKey, async () =>
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

    return this.runWithDeploymentLock(repo, deploymentKey, async () =>
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
    const existing = await this.deploymentStore.getById(`${repo.id}-${buildDeploymentKey(targetType, targetValue)}`);
    const seed = buildDeploySeed({
      repo,
      config: this.config,
      deploymentStore: this.deploymentStore,
      existing,
      targetType,
      targetValue,
      targetBranch,
      targetSha,
      sourceCloneSshUrl,
      lastEvent,
    });

    await this.deploymentStore.save(seed);
    await this.logger.info("Starting deployment", {
      deploymentId: seed.deploymentId,
      repoId: repo.id,
      deploymentKey: seed.deploymentKey,
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
        logFile: seed.logFile,
        env: buildDeployScriptEnv({
          repo,
          config: this.config,
          seed,
          sourceCloneSshUrl,
          targetType,
          targetValue,
          targetBranch,
          targetSha,
          lastEvent,
        }),
      });

      const finalMetadata = {
        ...seed,
        ...(result.parsed || {}),
        status: "running",
        lastEvent,
        logFile: seed.logFile,
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
        lastError: this.getFailureMessage(error),
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
    const existing = await this.deploymentStore.getById(`${repo.id}-${deploymentKey}`);
    const seed = buildDestroySeed({
      repo,
      config: this.config,
      deploymentStore: this.deploymentStore,
      existing,
      deploymentKey,
      lastEvent,
    });

    await this.deploymentStore.save(seed);
    await this.logger.info("Starting destroy", { deploymentId: seed.deploymentId, lastEvent });

    try {
      await this.scriptRunner.run({
        scriptPath: this.config.scripts.destroyPr,
        logFile: seed.logFile,
        env: buildDestroyScriptEnv({
          deploymentStore: this.deploymentStore,
          repoSlug: seed.repoSlug,
          deploymentKey: seed.deploymentKey,
          deploymentId: seed.deploymentId,
        }),
      });
      await this.publishGithubDeploymentStatus(repo, seed, {
        state: "inactive",
        description: "Preview deployment was destroyed.",
        autoInactive: false,
      });
      await this.logger.info("Destroy finished", { deploymentId: seed.deploymentId });
      return { destroyed: true, deploymentId: seed.deploymentId };
    } catch (error) {
      const failed = {
        ...seed,
        status: "failed",
        updatedAt: new Date().toISOString(),
        lastError: this.getFailureMessage(error),
      };
      await this.deploymentStore.save(failed);
      await this.logger.error("Destroy failed", { deploymentId: seed.deploymentId, error: failed.lastError });
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
        environmentUrl: state === "inactive" ? undefined : `http://${metadata.previewHost}`,
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

  async resolveRepoForDeployment(metadata) {
    const repo = await this.repoStore.getById(metadata.repoId);
    if (!repo) {
      throw new RepoValidationError("Repository for deployment no longer exists.");
    }
    return repo;
  }

  runWithDeploymentLock(repo, deploymentKey, task) {
    return this.lockManager.run(`${repo.id}:${deploymentKey}`, task);
  }

  getFailureMessage(error) {
    return error.parsed?.message || error.stderr || error.message;
  }
}

function unavailableRuntime(reason) {
  return {
    available: false,
    status: "unavailable",
    reason,
    containers: [],
    publicServiceContainer: null,
  };
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

export {
  DeploymentService,
};
