// @ts-nocheck
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import bcrypt from "bcryptjs";
import request from "supertest";

import { createApp } from "../../src/app.js";
import { getConfig } from "../../src/config.js";
import { FakeGithubDeploymentPublisher } from "./fake-github-deployment-publisher.js";
import { FakeRuntimeInspector } from "./fake-runtime-inspector.js";
import { FakeScriptRunner } from "./fake-script-runner.js";
import { FakeSshKeyManager } from "./fake-ssh-key-manager.js";

async function createTestContext(options = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "orchestrator-test-"));
  const password = options.password || "secret-pass";
  const config = getConfig({
    cwd: process.cwd(),
    DATA_ROOT: path.join(root, "data"),
    CONFIG_DIR: path.join(root, "data/config"),
    DEPLOYMENTS_DIR: path.join(root, "data/deployments"),
    LOGS_DIR: path.join(root, "data/logs"),
    SSH_DIR: path.join(root, "data/ssh"),
    BASE_DOMAIN: options.baseDomain || "preview.example.com",
    ADMIN_USERNAME: "admin",
    ADMIN_PASSWORD_BCRYPT_HASH: bcrypt.hashSync(password, 10),
    SESSION_SECRET: "test-session-secret",
    SESSION_COOKIE_SECURE: options.sessionCookieSecure,
    GITHUB_WEBHOOK_SECRET: "webhook-secret",
    GITHUB_DEPLOYMENTS_TOKEN: options.githubDeploymentsToken || "",
    ORCHESTRATOR_PUBLIC_URL:
      options.orchestratorPublicUrl || "https://previeworch.preview.example.com",
    NODE_ENV: options.nodeEnv || "test",
    DOCKER_SOCKET_PATH: path.join(root, "docker.sock"),
  });

  await fs.writeFile(config.dockerSocketPath, "", "utf8");

  const scriptRunner = new FakeScriptRunner({
    baseDomain: config.baseDomain,
    deployDelayMs: options.deployDelayMs || 0,
  });
  const sshKeyManager = options.sshKeyManager || new FakeSshKeyManager(options.initialSshKeyStatus);
  const runtimeInspector = options.runtimeInspector || new FakeRuntimeInspector();
  const githubDeploymentPublisher =
    options.githubDeploymentPublisher ||
    new FakeGithubDeploymentPublisher({
      enabled: Boolean(options.githubDeploymentsToken),
      orchestratorPublicUrl: config.orchestratorPublicUrl,
    });

  const app = await createApp({
    config,
    clientAssets: options.clientAssets,
    services: {
      scriptRunner,
      sshKeyManager,
      runtimeInspector,
      githubDeploymentPublisher,
    },
  });

  const agent = request.agent(app);

  return {
    agent,
    app,
    config,
    password,
    root,
    scriptRunner,
    sshKeyManager,
    runtimeInspector,
    githubDeploymentPublisher,
    cleanup: async () => {
      await fs.rm(root, { recursive: true, force: true });
    },
  };
}

async function getCsrf(agent, url) {
  const response = await agent.get(url);
  const match = response.text.match(/name="_csrf" value="([^"]+)"/);
  if (!match) {
    throw new Error(`Unable to find CSRF token for ${url}`);
  }
  return match[1];
}

async function login(agent, password) {
  const csrfToken = await getCsrf(agent, "/login");
  await agent.post("/login").type("form").send({
    username: "admin",
    password,
    _csrf: csrfToken,
  });
}

async function getDashboardCsrf(agent) {
  return getCsrf(agent, "/");
}

function buildPullRequestPayload(action, overrides = {}) {
  return {
    action,
    number: overrides.prNumber || 17,
    repository: {
      full_name: overrides.repoFullName || "acme/widgets",
      name: overrides.repoName || "widgets",
      ssh_url: overrides.baseSshUrl || "git@github.com:acme/widgets.git",
      owner: {
        login: overrides.repoOwner || "acme",
      },
    },
    pull_request: {
      number: overrides.prNumber || 17,
      author_association: overrides.prAuthorAssociation || "NONE",
      user: {
        login: overrides.prAuthorLogin || overrides.senderLogin || "octocat",
      },
      head: {
        ref: overrides.prBranch || "feature/test",
        sha: overrides.prSha || "abc123",
        repo: {
          full_name: overrides.headRepoFullName || overrides.repoFullName || "acme/widgets",
          ssh_url:
            overrides.headSshUrl || overrides.baseSshUrl || "git@github.com:acme/widgets.git",
        },
      },
    },
    sender: {
      login: overrides.senderLogin || overrides.prAuthorLogin || "octocat",
    },
  };
}

function signPayload(secret, payload) {
  const raw = JSON.stringify(payload);
  const signature = crypto.createHmac("sha256", secret).update(raw).digest("hex");
  return {
    raw,
    signature: `sha256=${signature}`,
  };
}

export { buildPullRequestPayload, createTestContext, getDashboardCsrf, login, signPayload };
