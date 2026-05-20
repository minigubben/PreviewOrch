// @ts-nocheck
import test from "node:test";
import assert from "node:assert/strict";

import { buildDeployScriptEnv, buildDestroyScriptEnv } from "../src/lib/deployment-script-env.js";

test("buildDeployScriptEnv preserves script env keys and string conversions", () => {
  const env = buildDeployScriptEnv({
    repo: {
      id: "repo-1",
      owner: "acme",
      name: "widgets",
      defaultBranch: "main",
      workingDirectory: "ops/preview",
      composePath: "docker-compose.preview.yml",
      publicService: "app",
      publicPort: 3000,
      appendProxySettings: true,
      extraEnv: { NODE_ENV: "production" },
    },
    config: {
      baseDomain: "preview.example.com",
      deploymentsDir: "/tmp/deployments",
      traefikNetworkName: "preview-proxy",
    },
    seed: {
      deploymentKey: "pr-17",
      repoSlug: "acme-widgets",
      logFile: "/tmp/logs/acme-widgets-pr-17.log",
      previewHost: "acme-widgets-pr-17.preview.example.com",
      extraEnv: { NODE_ENV: "staging" },
      targetBranch: "feature/test",
    },
    repoAccess: {
      repoFullName: "acme/widgets",
      repoUrl: "https://github.com/acme/widgets.git",
      installation: { id: 99 },
      token: "install-token-99",
    },
    targetType: "pr",
    targetValue: 17,
    targetBranch: "feature/test",
    targetSha: "abc123",
    lastEvent: "opened",
  });

  assert.equal(env.REPO_ID, "repo-1");
  assert.equal(env.PUBLIC_PORT, "3000");
  assert.equal(env.APPEND_PROXY_SETTINGS, "true");
  assert.equal(env.EXTRA_ENV_JSON, JSON.stringify({ NODE_ENV: "staging" }));
  assert.equal(env.PREVIEW_HOST, "acme-widgets-pr-17.preview.example.com");
  assert.equal(env.TARGET_VALUE, "17");
  assert.equal(env.REPO_FULL_NAME, "acme/widgets");
  assert.equal(env.GITHUB_REPO_URL, "https://github.com/acme/widgets.git");
  assert.equal(env.GITHUB_INSTALLATION_ID, "99");
  assert.equal(env.GITHUB_INSTALLATION_TOKEN, "install-token-99");
});

test("buildDestroyScriptEnv uses the deployment store metadata path format", () => {
  const env = buildDestroyScriptEnv({
    deploymentStore: {
      getMetadataPath(repoSlug, deploymentKey) {
        return `/tmp/deployments/${repoSlug}/${deploymentKey}/deployment.json`;
      },
    },
    repoSlug: "acme-widgets",
    deploymentKey: "pr-17",
    deploymentId: "repo-1-pr-17",
  });

  assert.deepEqual(env, {
    DEPLOYMENT_METADATA_PATH: "/tmp/deployments/acme-widgets/pr-17/deployment.json",
    DEPLOYMENT_ID: "repo-1-pr-17",
  });
});
