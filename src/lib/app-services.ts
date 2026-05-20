// @ts-nocheck
import { DeploymentService } from "./deployment-service.js";
import { DeploymentStore } from "./deployment-store.js";
import { GithubAppClient } from "./github-app-client.js";
import { GithubAppStore } from "./github-app-store.js";
import { GithubInstallationResolver } from "./github-installation-resolver.js";
import { GithubPullRequestCommentPublisher } from "./github-pull-request-comment-publisher.js";
import { LockManager } from "./lock-manager.js";
import { Logger } from "./logger.js";
import { RepoStore } from "./repo-store.js";
import { RuntimeInspector } from "./runtime-inspector.js";
import { ScriptRunner } from "./script-runner.js";

function buildAppServices({ config, services = {} }) {
  const logger =
    services.logger ||
    new Logger({ appLogFile: config.appLogFile, eventsLogFile: config.eventsLogFile });
  const scriptRunner = services.scriptRunner || new ScriptRunner({ logger });
  const githubAppStore =
    services.githubAppStore || new GithubAppStore({ settingsFile: config.settingsFile });
  const githubAppClient =
    services.githubAppClient ||
    new GithubAppClient({ apiBaseUrl: config.githubApiBaseUrl, logger });
  const githubInstallationResolver =
    services.githubInstallationResolver ||
    new GithubInstallationResolver({
      githubAppStore,
      githubAppClient,
      logger,
    });
  const repoStore =
    services.repoStore ||
    new RepoStore({
      reposFile: config.reposFile,
      validateScriptPath: config.scripts.validateRepo,
      scriptRunner,
      logger,
      githubInstallationResolver,
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
      githubInstallationResolver,
      githubPullRequestCommentPublisher:
        services.githubPullRequestCommentPublisher ||
        new GithubPullRequestCommentPublisher({
          githubAppClient,
          githubInstallationResolver,
          logger,
          orchestratorPublicUrl: config.orchestratorPublicUrl,
        }),
    });

  return {
    deploymentService,
    deploymentStore,
    githubAppClient,
    githubAppStore,
    githubInstallationResolver,
    logger,
    repoStore,
    scriptRunner,
  };
}

export { buildAppServices };
