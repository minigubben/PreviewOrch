// @ts-nocheck
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import bcrypt from "bcryptjs";
import request from "supertest";

import { createApp } from "../../src/app.js";
import { getConfig } from "../../src/config.js";
import { GithubAppStore } from "../../src/lib/github-app-store.js";
import { GithubInstallationResolver } from "../../src/lib/github-installation-resolver.js";
import { GithubPullRequestCommentPublisher } from "../../src/lib/github-pull-request-comment-publisher.js";
import { FakeRuntimeInspector } from "./fake-runtime-inspector.js";
import { FakeScriptRunner } from "./fake-script-runner.js";
import { FakeGithubAppClient } from "./fake-github-app-client.js";

const noopLogger = {
  info: async () => undefined,
  warn: async () => undefined,
  error: async () => undefined,
};

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
  const runtimeInspector = options.runtimeInspector || new FakeRuntimeInspector();
  const githubAppStore = options.githubAppStore || new GithubAppStore({ settingsFile: config.settingsFile });
  const githubAppClient =
    options.githubAppClient ||
    new FakeGithubAppClient({
      installations: options.installations || [
        {
          id: 99,
          account: { login: "acme" },
          target_type: "Organization",
          repository_selection: "selected",
          permissions: {
            metadata: "read",
            contents: "read",
            pull_requests: "write",
          },
          events: ["pull_request"],
          html_url: "https://github.com/organizations/acme/settings/installations/99",
          repositories_url: "https://api.github.com/installation/repositories",
          suspended_at: null,
          created_at: "2026-05-20T00:00:00.000Z",
          updated_at: "2026-05-20T00:00:00.000Z",
          repositories: [
            {
              id: 1001,
              name: "widgets",
              full_name: "acme/widgets",
              private: true,
              owner: { login: "acme" },
            },
          ],
        },
      ],
    });
  const githubInstallationResolver =
    options.githubInstallationResolver ||
    new GithubInstallationResolver({
      githubAppStore,
      githubAppClient,
      logger: options.logger || noopLogger,
    });
  const githubPullRequestCommentPublisher =
    options.githubPullRequestCommentPublisher ||
    new GithubPullRequestCommentPublisher({
      githubAppClient,
      githubInstallationResolver,
      logger: options.logger || noopLogger,
      orchestratorPublicUrl: config.orchestratorPublicUrl,
    });

  if (options.initialGithubApp !== false) {
    await githubAppStore.saveGithubApp({
      appId: 123,
      clientId: "Iv1.fakeclient",
      clientSecret: "fake-client-secret",
      privateKeyPem: "-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----",
      webhookSecret: "webhook-secret",
      slug: "previeworch",
      name: "PreviewOrch",
      ownerLogin: "previeworch-owner",
      ownerType: "User",
      installations: [],
    });
    await githubInstallationResolver.refreshInstallationsUsingApp();
  }

  const app = await createApp({
    config,
    clientAssets: options.clientAssets,
    services: {
      scriptRunner,
      runtimeInspector,
      githubAppStore,
      githubAppClient,
      githubInstallationResolver,
      githubPullRequestCommentPublisher,
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
    runtimeInspector,
    githubAppStore,
    githubAppClient,
    githubInstallationResolver,
    githubPullRequestCommentPublisher,
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
        },
      },
    },
    installation: {
      id: overrides.installationId || 99,
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
