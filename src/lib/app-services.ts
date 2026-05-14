// @ts-nocheck
import { DeploymentService } from "./deployment-service.js";
import { DeploymentStore } from "./deployment-store.js";
import { GithubDeploymentPublisher } from "./github-deployment-publisher.js";
import { LockManager } from "./lock-manager.js";
import { Logger } from "./logger.js";
import { RepoStore } from "./repo-store.js";
import { RuntimeInspector } from "./runtime-inspector.js";
import { ScriptRunner } from "./script-runner.js";
import { SshKeyManager } from "./ssh-key-manager.js";

function buildAppServices({ config, services = {} }) {
  const logger =
    services.logger ||
    new Logger({ appLogFile: config.appLogFile, eventsLogFile: config.eventsLogFile });
  const scriptRunner = services.scriptRunner || new ScriptRunner({ logger });
  const repoStore =
    services.repoStore ||
    new RepoStore({
      reposFile: config.reposFile,
      validateScriptPath: config.scripts.validateRepo,
      scriptRunner,
      logger,
      sshDir: config.sshDir,
    });
  const deploymentStore =
    services.deploymentStore ||
    new DeploymentStore({
      deploymentsDir: config.deploymentsDir,
      deploymentLogsDir: config.deploymentLogsDir,
    });
  const deploymentService =
    services.deploymentService ||
    new DeploymentService({
      config,
      logger,
      repoStore,
      deploymentStore,
      scriptRunner,
      lockManager: services.lockManager || new LockManager(),
      runtimeInspector: services.runtimeInspector || new RuntimeInspector({ logger }),
      githubDeploymentPublisher:
        services.githubDeploymentPublisher ||
        new GithubDeploymentPublisher({
          apiBaseUrl: config.githubApiBaseUrl,
          token: config.githubDeploymentsToken,
          logger,
          orchestratorPublicUrl: config.orchestratorPublicUrl,
        }),
    });
  const sshKeyManager =
    services.sshKeyManager || new SshKeyManager({ sshDir: config.sshDir, logger });

  return {
    deploymentService,
    deploymentStore,
    logger,
    repoStore,
    scriptRunner,
    sshKeyManager,
  };
}

export { buildAppServices };
