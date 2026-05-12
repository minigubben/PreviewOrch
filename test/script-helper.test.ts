import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";

import {
  getDeploymentPaths,
  validateComposeContract,
  writeProxyOverride,
  writeRuntimeEnvFile,
} from "../src/cli/script-helper.js";

const execFile = promisify(execFileCallback);

test("getDeploymentPaths derives the compiled script helper paths", () => {
  const paths = getDeploymentPaths({
    BASE_DOMAIN: "preview.example.com",
    COMPOSE_PATH: "deploy/preview-compose.yml",
    DEPLOYMENTS_DIR: "/tmp/deployments",
    DEPLOYMENT_KEY: "pr-42",
    REPO_ID: "repo-1",
    REPO_SLUG: "acme-widgets",
    TARGET_TYPE: "pr",
    TARGET_VALUE: "42",
    WORKING_DIRECTORY: ".",
  });

  assert.equal(paths.deploymentId, "repo-1-pr-42");
  assert.equal(paths.previewHost, "acme-widgets-pr-42.preview.example.com");
  assert.equal(paths.metadataPath, "/tmp/deployments/acme-widgets/pr-42/deployment.json");
});

test("script helper CLI supports resolve-deploy-field for shell-script compatibility", async () => {
  const scriptPath = new URL("../src/cli/script-helper.js", import.meta.url);
  const { stdout } = await execFile(process.execPath, [scriptPath.pathname, "resolve-deploy-field", "projectName"], {
    env: {
      ...process.env,
      BASE_DOMAIN: "preview.example.com",
      COMPOSE_PATH: "deploy/preview-compose.yml",
      DEPLOYMENTS_DIR: "/tmp/deployments",
      DEPLOYMENT_KEY: "pr-42",
      REPO_ID: "repo-1",
      REPO_SLUG: "acme-widgets",
      TARGET_TYPE: "pr",
      TARGET_VALUE: "42",
      WORKING_DIRECTORY: ".",
    },
  });

  assert.equal(stdout, "acme-widgets-pr-42");
});

test("writeRuntimeEnvFile writes orchestrator and extra env values", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "orchestrator-helper-"));
  const envFile = path.join(root, ".env.runtime");

  try {
    writeRuntimeEnvFile(
      {
        EXTRA_ENV_JSON: JSON.stringify({ API_ORIGIN: "https://api.example.com" }),
        PREVIEW_HOST_ENV_VAR_NAME: "APP_FQDN",
        PUBLIC_PORT: "3000",
        REPO_SLUG: "acme-widgets",
        TARGET_BRANCH: "feature/demo",
        TARGET_SHA: "deadbeef",
        TARGET_TYPE: "pr",
        TARGET_VALUE: "42",
      },
      envFile,
      "acme-widgets-pr-42.preview.example.com",
      "acme-widgets-pr-42",
    );

    const contents = await fs.readFile(envFile, "utf8");
    assert.match(contents, /ORCH_PROJECT_NAME=acme-widgets-pr-42/);
    assert.match(contents, /APP_FQDN=acme-widgets-pr-42\.preview\.example\.com/);
    assert.match(contents, /API_ORIGIN=https:\/\/api\.example\.com/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("writeProxyOverride preserves existing compose networking by only adding labels", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "orchestrator-proxy-"));
  const overridePath = path.join(root, ".orchestrator-proxy.override.yml");
  const composePath = path.join(root, "compose.yml");

  try {
    await fs.writeFile(
      composePath,
      [
        "services:",
        "  app:",
        "    image: nginx:latest",
      ].join("\n"),
      "utf8",
    );

    writeProxyOverride(
      {
        COMPOSE_ABS_PATH: composePath,
        PUBLIC_PORT: "3000",
        PUBLIC_SERVICE: "app",
        TRAEFIK_NETWORK_NAME: "preview-proxy",
      },
      overridePath,
      "acme-widgets-pr-42.preview.example.com",
      "acme-widgets-pr-42",
    );

    const contents = await fs.readFile(overridePath, "utf8");
    assert.match(contents, /traefik\.enable: "true"/);
    assert.match(contents, /traefik\.docker\.network: preview-proxy/);
    assert.match(contents, /services:\s+app:\s+networks:\s+- default\s+- preview-proxy/s);
    assert.match(contents, /preview-proxy:\s+[\s\S]*external: true/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("writeProxyOverride preserves explicitly declared service networks", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "orchestrator-proxy-explicit-"));
  const overridePath = path.join(root, ".orchestrator-proxy.override.yml");
  const composePath = path.join(root, "compose.yml");

  try {
    await fs.writeFile(
      composePath,
      [
        "services:",
        "  app:",
        "    image: nginx:latest",
        "    networks:",
        "      internal:",
        "        aliases:",
        "          - appalias",
        "networks:",
        "  internal: {}",
      ].join("\n"),
      "utf8",
    );

    writeProxyOverride(
      {
        COMPOSE_ABS_PATH: composePath,
        PUBLIC_PORT: "3000",
        PUBLIC_SERVICE: "app",
        TRAEFIK_NETWORK_NAME: "preview-proxy",
      },
      overridePath,
      "acme-widgets-pr-42.preview.example.com",
      "acme-widgets-pr-42",
    );

    const contents = await fs.readFile(overridePath, "utf8");
    assert.match(contents, /services:\s+app:\s+networks:\s+- internal\s+- preview-proxy/s);
    assert.doesNotMatch(contents, /- default/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("validateComposeContract accepts a compose file with the required label contract", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "orchestrator-compose-"));
  const composePath = path.join(root, "compose.yml");

  try {
    await fs.writeFile(
      composePath,
      [
        "services:",
        "  app:",
        "    labels:",
        '      - "traefik.enable=true"',
        '      - "traefik.http.routers.${ORCH_PROJECT_NAME}.rule=Host(`${ORCH_PREVIEW_HOST}`)"',
        '      - "traefik.http.services.${ORCH_PROJECT_NAME}.loadbalancer.server.port=${ORCH_PREVIEW_SERVICE_PORT}"',
      ].join("\n"),
      "utf8",
    );

    assert.deepEqual(validateComposeContract(composePath, "app", false), {
      ok: true,
      message: "Repository validation passed.",
    });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
