const { DeploymentService } = require("./deployment-service");
const { DeploymentStore } = require("./deployment-store");
const { GithubDeploymentPublisher } = require("./github-deployment-publisher");
const { LockManager } = require("./lock-manager");
const { Logger } = require("./logger");
const { RepoStore } = require("./repo-store");
const { RuntimeInspector } = require("./runtime-inspector");
const { ScriptRunner } = require("./script-runner");
const { SshKeyManager } = require("./ssh-key-manager");

function buildAppServices({ config, services = {} }) {
  const logger = services.logger || new Logger({ appLogFile: config.appLogFile, eventsLogFile: config.eventsLogFile });
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
  const sshKeyManager = services.sshKeyManager || new SshKeyManager({ sshDir: config.sshDir, logger });

  return {
    deploymentService,
    deploymentStore,
    logger,
    repoStore,
    scriptRunner,
    sshKeyManager,
  };
}

module.exports = {
  buildAppServices,
};
