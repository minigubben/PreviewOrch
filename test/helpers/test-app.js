const fs = require("fs/promises");
const os = require("os");
const path = require("path");

const bcrypt = require("bcryptjs");
const request = require("supertest");

const { createApp } = require("../../src/app");
const { getConfig } = require("../../src/config");
const { FakeScriptRunner } = require("./fake-script-runner");

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
    GITHUB_WEBHOOK_SECRET: "webhook-secret",
    NODE_ENV: "test",
    DOCKER_SOCKET_PATH: path.join(root, "docker.sock"),
  });

  await fs.writeFile(config.dockerSocketPath, "", "utf8");

  const scriptRunner = new FakeScriptRunner({
    baseDomain: config.baseDomain,
    deployDelayMs: options.deployDelayMs || 0,
  });

  const app = await createApp({
    config,
    services: {
      scriptRunner,
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
      head: {
        ref: overrides.prBranch || "feature/test",
        sha: overrides.prSha || "abc123",
        repo: {
          full_name: overrides.headRepoFullName || overrides.repoFullName || "acme/widgets",
          ssh_url: overrides.headSshUrl || overrides.baseSshUrl || "git@github.com:acme/widgets.git",
        },
      },
    },
  };
}

function signPayload(secret, payload) {
  const crypto = require("crypto");
  const raw = JSON.stringify(payload);
  const signature = crypto.createHmac("sha256", secret).update(raw).digest("hex");
  return {
    raw,
    signature: `sha256=${signature}`,
  };
}

module.exports = {
  buildPullRequestPayload,
  createTestContext,
  getDashboardCsrf,
  login,
  signPayload,
};
