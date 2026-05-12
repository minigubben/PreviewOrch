// @ts-nocheck
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

export {
  buildGithubDeploymentDescription,
  buildGithubDeploymentRef,
  buildGithubEnvironmentName,
};
