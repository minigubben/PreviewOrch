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
      sshDir: "/tmp/ssh",
    },
    seed: {
      deploymentKey: "pr-17",
      repoSlug: "acme-widgets",
      logFile: "/tmp/logs/acme-widgets-pr-17.log",
    },
    sourceCloneSshUrl: "git@github.com:acme/widgets.git",
    targetType: "pr",
    targetValue: 17,
    targetBranch: "feature/test",
    targetSha: "abc123",
    lastEvent: "opened",
  });

  assert.equal(env.REPO_ID, "repo-1");
  assert.equal(env.PUBLIC_PORT, "3000");
  assert.equal(env.APPEND_PROXY_SETTINGS, "true");
  assert.equal(env.EXTRA_ENV_JSON, JSON.stringify({ NODE_ENV: "production" }));
  assert.equal(env.TARGET_VALUE, "17");
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
