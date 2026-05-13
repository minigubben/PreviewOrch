// @ts-nocheck
function buildDeployScriptEnv({ repo, config, seed, sourceCloneSshUrl, targetType, targetValue, targetBranch, targetSha, lastEvent }) {
  return {
    REPO_ID: repo.id,
    REPO_OWNER: repo.owner,
    REPO_NAME: repo.name,
    REPO_SLUG: seed.repoSlug,
    SOURCE_CLONE_SSH_URL: sourceCloneSshUrl,
    DEFAULT_BRANCH: repo.defaultBranch,
    WORKING_DIRECTORY: repo.workingDirectory || ".",
    COMPOSE_PATH: repo.composePath,
    PUBLIC_SERVICE: repo.publicService,
    PUBLIC_PORT: String(repo.publicPort),
    APPEND_PROXY_SETTINGS: String(repo.appendProxySettings),
    EXTRA_ENV_JSON: JSON.stringify(repo.extraEnv || {}),
    DEPLOYMENT_KEY: seed.deploymentKey,
    TARGET_TYPE: targetType,
    TARGET_VALUE: String(targetValue),
    TARGET_BRANCH: targetBranch || "",
    TARGET_SHA: targetSha || "",
    BASE_DOMAIN: config.baseDomain,
    DEPLOYMENTS_DIR: config.deploymentsDir,
    LOG_FILE: seed.logFile,
    LAST_EVENT: lastEvent,
    TRAEFIK_NETWORK_NAME: config.traefikNetworkName,
    SSH_DIR: config.sshDir,
  };
}

function buildDestroyScriptEnv({ deploymentStore, repoSlug, deploymentKey, deploymentId }) {
  return {
    DEPLOYMENT_METADATA_PATH: deploymentStore.getMetadataPath(repoSlug, deploymentKey),
    DEPLOYMENT_ID: deploymentId,
  };
}

export {
  buildDeployScriptEnv,
  buildDestroyScriptEnv,
};
