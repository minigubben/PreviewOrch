// @ts-nocheck
import path from "node:path";

import { buildDeploymentKey, buildPreviewHost, buildProjectName, slugifyRepo } from "./utils.js";

function buildDeploySeed({
  repo,
  config,
  deploymentStore,
  existing,
  targetType,
  targetValue,
  targetBranch,
  targetSha,
  sourceCloneSshUrl,
  lastEvent,
}) {
  const repoSlug = repo.slug || slugifyRepo(repo.owner, repo.name);
  const deploymentKey = existing?.deploymentKey || buildDeploymentKey(targetType, targetValue);
  const previewHost = buildPreviewHost(repoSlug, deploymentKey, config.baseDomain);
  const projectName = buildProjectName(repoSlug, deploymentKey);
  const workDir = deploymentStore.getWorkDir(repoSlug, deploymentKey);
  const projectDirectoryResolved = path.resolve(workDir, repo.workingDirectory || ".");
  const logFile = deploymentStore.getLogPath(repoSlug, deploymentKey);
  const composePathResolved = path.resolve(projectDirectoryResolved, repo.composePath);
  const now = new Date().toISOString();

  return {
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
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    publicPort: repo.publicPort,
    publicService: repo.publicService,
    appendProxySettings: repo.appendProxySettings,
    extraEnv: repo.extraEnv || {},
    githubDeployment: existing?.githubDeployment || null,
  };
}

function buildDestroySeed({ repo, config, deploymentStore, existing, deploymentKey, lastEvent }) {
  const repoSlug = repo.slug || slugifyRepo(repo.owner, repo.name);
  const deploymentId = `${repo.id}-${deploymentKey}`;
  const previewHost = buildPreviewHost(repoSlug, deploymentKey, config.baseDomain);
  const projectName = buildProjectName(repoSlug, deploymentKey);
  const workDir = deploymentStore.getWorkDir(repoSlug, deploymentKey);
  const projectDirectoryResolved = existing?.projectDirectoryResolved || path.resolve(workDir, repo.workingDirectory || ".");
  const composePathResolved = existing?.composePathResolved || path.resolve(projectDirectoryResolved, repo.composePath);
  const logFile = deploymentStore.getLogPath(repoSlug, deploymentKey);

  return {
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
    extraEnv: repo.extraEnv || {},
    githubDeployment: existing?.githubDeployment || null,
  };
}

export {
  buildDeploySeed,
  buildDestroySeed,
};
