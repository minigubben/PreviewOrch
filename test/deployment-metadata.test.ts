// @ts-nocheck
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import { buildDeploySeed, buildDestroySeed } from "../src/lib/deployment-metadata.js";

function createRepo() {
  return {
    id: "repo-1",
    owner: "acme",
    name: "widgets",
    slug: "acme-widgets",
    workingDirectory: "ops/preview",
    composePath: "docker-compose.preview.yml",
    cloneSshUrl: "git@github.com:acme/widgets.git",
    publicPort: 3000,
    publicService: "app",
    appendProxySettings: true,
    extraEnv: { NODE_ENV: "production" },
    defaultBranchCustomHost: "app.example.com",
    defaultBranchExtraEnv: { NODE_ENV: "staging" },
  };
}

function createConfig() {
  return {
    baseDomain: "preview.example.com",
  };
}

function createDeploymentStore() {
  return {
    getWorkDir(repoSlug, deploymentKey) {
      return path.join("/tmp/deployments", repoSlug, deploymentKey);
    },
    getLogPath(repoSlug, deploymentKey) {
      return path.join("/tmp/logs", `${repoSlug}-${deploymentKey}.log`);
    },
  };
}

test("buildDeploySeed preserves createdAt from an existing deployment", () => {
  const seed = buildDeploySeed({
    repo: createRepo(),
    config: createConfig(),
    deploymentStore: createDeploymentStore(),
    existing: {
      createdAt: "2026-05-11T10:00:00.000Z",
      githubDeployment: { id: 1000 },
    },
    targetType: "pr",
    targetValue: 17,
    targetBranch: "feature/test",
    targetSha: "abc123",
    sourceCloneSshUrl: "git@github.com:acme/widgets.git",
    lastEvent: "opened",
  });

  assert.equal(seed.createdAt, "2026-05-11T10:00:00.000Z");
  assert.equal(seed.deploymentId, "repo-1-pr-17");
  assert.equal(seed.projectDirectoryResolved, path.join("/tmp/deployments", "acme-widgets", "pr-17", "ops/preview"));
  assert.equal(seed.composePathResolved, path.join("/tmp/deployments", "acme-widgets", "pr-17", "ops/preview", "docker-compose.preview.yml"));
  assert.deepEqual(seed.githubDeployment, { id: 1000 });
});

test("buildDeploySeed uses dedicated host and env for default branch deployments", () => {
  const seed = buildDeploySeed({
    repo: createRepo(),
    config: createConfig(),
    deploymentStore: createDeploymentStore(),
    existing: null,
    targetType: "default-branch",
    targetValue: "main",
    targetBranch: "main",
    targetSha: null,
    sourceCloneSshUrl: "git@github.com:acme/widgets.git",
    lastEvent: "manual-deploy",
  });

  assert.equal(seed.deploymentId, "repo-1-default-branch");
  assert.equal(seed.deploymentKey, "default-branch");
  assert.equal(seed.previewHost, "app.example.com");
  assert.equal(seed.targetBranch, "main");
  assert.deepEqual(seed.extraEnv, { NODE_ENV: "staging" });
});

test("buildDestroySeed falls back correctly when existing metadata is partial", () => {
  const seed = buildDestroySeed({
    repo: createRepo(),
    config: createConfig(),
    deploymentStore: createDeploymentStore(),
    existing: {
      createdAt: "2026-05-11T10:00:00.000Z",
      targetType: "branch",
      targetValue: "release/2026-q2",
      githubDeployment: { id: 1001 },
    },
    deploymentKey: "branch-release-2026-q2",
    lastEvent: "manual-destroy",
  });

  assert.equal(seed.deploymentId, "repo-1-branch-release-2026-q2");
  assert.equal(seed.targetType, "branch");
  assert.equal(seed.targetValue, "release/2026-q2");
  assert.equal(seed.workingDirectory, "ops/preview");
  assert.equal(seed.composePathResolved, path.join("/tmp/deployments", "acme-widgets", "branch-release-2026-q2", "ops/preview", "docker-compose.preview.yml"));
  assert.deepEqual(seed.githubDeployment, { id: 1001 });
});
