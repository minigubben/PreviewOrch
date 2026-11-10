// @ts-nocheck
import test from "node:test";
import assert from "node:assert/strict";

import { createRepo } from "./helpers/app-test-helpers.js";
import { createTestContext, getDashboardCsrf, login } from "./helpers/test-app.js";

test("adds a repository with valid configuration", async () => {
  const context = await createTestContext();
  test.after(() => context.cleanup());

  await login(context.agent, context.password);
  const csrfToken = await getDashboardCsrf(context.agent);
  const response = await createRepo(context.agent, csrfToken);

  assert.equal(response.status, 201);
  assert.equal(response.body.owner, "acme");
  assert.equal(response.body.name, "widgets");
  assert.equal(response.body.appendProxySettings, false);
  assert.deepEqual(response.body.extraEnv, {});
  assert.equal(response.body.defaultBranchCustomHost, "");
  assert.deepEqual(response.body.defaultBranchExtraEnv, {});
  assert.equal(response.body.workingDirectory, ".");
  assert.equal(response.body.prDeploymentAccess, "anyone");
  assert.deepEqual(response.body.prDeploymentAllowedLogins, []);
  assert.equal(
    context.scriptRunner.calls.filter((call) => call.scriptName === "validate-repo.sh").length,
    1,
  );
});

test("dashboard repo form lists repositories from the installed GitHub App", async () => {
  const context = await createTestContext();
  test.after(() => context.cleanup());

  await login(context.agent, context.password);
  const response = await context.agent.get("/");

  assert.equal(response.status, 200);
  assert.match(response.text, /Select a repository from the installed GitHub App/);
  assert.match(response.text, /acme\/widgets/);
});

test("derives owner and repo name from the clone url", async () => {
  const context = await createTestContext({
    installations: [
      {
        id: 99,
        account: { login: "ExtronicElektronik" },
        target_type: "Organization",
        repository_selection: "selected",
        permissions: {
          metadata: "read",
          contents: "read",
          pull_requests: "write",
        },
        events: ["pull_request"],
        html_url: "https://github.com/organizations/ExtronicElektronik/settings/installations/99",
        repositories_url: "https://api.github.com/installation/repositories",
        suspended_at: null,
        created_at: "2026-05-20T00:00:00.000Z",
        updated_at: "2026-05-20T00:00:00.000Z",
        repositories: [
          {
            id: 1002,
            name: "simcards",
            full_name: "ExtronicElektronik/simcards",
            private: true,
            owner: { login: "ExtronicElektronik" },
          },
        ],
      },
    ],
  });
  test.after(() => context.cleanup());

  await login(context.agent, context.password);
  const csrfToken = await getDashboardCsrf(context.agent);
  const response = await createRepo(context.agent, csrfToken, {
    owner: "wrong-owner",
    name: "wrong-name",
    repository: "ExtronicElektronik/simcards",
  });

  assert.equal(response.status, 201);
  assert.equal(response.body.owner, "ExtronicElektronik");
  assert.equal(response.body.name, "simcards");
  assert.equal(response.body.slug, "extronicelektronik-simcards");
});

test("stores additional env vars from the admin ui", async () => {
  const context = await createTestContext();
  test.after(() => context.cleanup());

  await login(context.agent, context.password);
  const csrfToken = await getDashboardCsrf(context.agent);
  const response = await createRepo(context.agent, csrfToken, {
    extraEnvText: "NODE_ENV=production\nAPI_ORIGIN=https://api.example.com",
  });

  assert.equal(response.status, 201);
  assert.deepEqual(response.body.extraEnv, {
    NODE_ENV: "production",
    API_ORIGIN: "https://api.example.com",
  });
  assert.equal(
    response.body.extraEnvText,
    "NODE_ENV=production\nAPI_ORIGIN=https://api.example.com",
  );
});

test("stores default branch deployment host and env vars from the admin ui", async () => {
  const context = await createTestContext();
  test.after(() => context.cleanup());

  await login(context.agent, context.password);
  const csrfToken = await getDashboardCsrf(context.agent);
  const response = await createRepo(context.agent, csrfToken, {
    defaultBranchCustomHost: "app.example.com",
    defaultBranchExtraEnvText: "NODE_ENV=production\nAPI_ORIGIN=https://api.example.com",
  });

  assert.equal(response.status, 201);
  assert.equal(response.body.defaultBranchCustomHost, "app.example.com");
  assert.deepEqual(response.body.defaultBranchExtraEnv, {
    NODE_ENV: "production",
    API_ORIGIN: "https://api.example.com",
  });
  assert.equal(
    response.body.defaultBranchExtraEnvText,
    "NODE_ENV=production\nAPI_ORIGIN=https://api.example.com",
  );
});

test("stores PR trigger policy and allowlist from the admin ui", async () => {
  const context = await createTestContext();
  test.after(() => context.cleanup());

  await login(context.agent, context.password);
  const csrfToken = await getDashboardCsrf(context.agent);
  const response = await createRepo(context.agent, csrfToken, {
    prDeploymentAccess: "contributors",
    prDeploymentAllowedLoginsText: "Dependabot[bot]\nrelease-bot",
  });

  assert.equal(response.status, 201);
  assert.equal(response.body.prDeploymentAccess, "contributors");
  assert.deepEqual(response.body.prDeploymentAllowedLogins, ["dependabot[bot]", "release-bot"]);
  assert.equal(response.body.prDeploymentAllowedLoginsText, "dependabot[bot]\nrelease-bot");
});

test("allows a repo without traefik labels when proxy settings will be appended", async () => {
  const context = await createTestContext();
  test.after(() => context.cleanup());

  await login(context.agent, context.password);
  const csrfToken = await getDashboardCsrf(context.agent);
  const response = await createRepo(context.agent, csrfToken, {
    composePath: "missing-labels.yml",
    appendProxySettings: true,
  });

  assert.equal(response.status, 201);
  assert.equal(response.body.appendProxySettings, true);
});

test("rejects a repository with a missing compose path", async () => {
  const context = await createTestContext();
  test.after(() => context.cleanup());

  await login(context.agent, context.password);
  const csrfToken = await getDashboardCsrf(context.agent);
  const response = await createRepo(context.agent, csrfToken, {
    composePath: "missing-compose.yml",
  });

  assert.equal(response.status, 400);
  assert.match(response.body.error, /Compose file does not exist/);
});

test("rejects a repository missing the traefik label contract", async () => {
  const context = await createTestContext();
  test.after(() => context.cleanup());

  await login(context.agent, context.password);
  const csrfToken = await getDashboardCsrf(context.agent);
  const response = await createRepo(context.agent, csrfToken, {
    composePath: "missing-labels.yml",
  });

  assert.equal(response.status, 400);
  assert.match(response.body.error, /Missing required Traefik label contract token/);
});

test("rejects invalid additional env variable names", async () => {
  const context = await createTestContext();
  test.after(() => context.cleanup());

  await login(context.agent, context.password);
  const csrfToken = await getDashboardCsrf(context.agent);
  const response = await createRepo(context.agent, csrfToken, {
    extraEnvText: "bad-name=value",
  });

  assert.equal(response.status, 400);
  assert.match(response.body.error, /must be a valid environment variable name/);
});

test("rejects an invalid default branch fqdn", async () => {
  const context = await createTestContext();
  test.after(() => context.cleanup());

  await login(context.agent, context.password);
  const csrfToken = await getDashboardCsrf(context.agent);
  const response = await createRepo(context.agent, csrfToken, {
    defaultBranchCustomHost: "https://app.example.com",
  });

  assert.equal(response.status, 400);
  assert.match(response.body.error, /must be a valid fully qualified domain name/);
});

test("rejects invalid PR trigger allowlist entries", async () => {
  const context = await createTestContext();
  test.after(() => context.cleanup());

  await login(context.agent, context.password);
  const csrfToken = await getDashboardCsrf(context.agent);
  const response = await createRepo(context.agent, csrfToken, {
    prDeploymentAllowedLoginsText: "not valid",
  });

  assert.equal(response.status, 400);
  assert.match(response.body.error, /must contain valid GitHub login names/);
});

test("rejects a working directory outside the repository", async () => {
  const context = await createTestContext();
  test.after(() => context.cleanup());

  await login(context.agent, context.password);
  const csrfToken = await getDashboardCsrf(context.agent);
  const response = await createRepo(context.agent, csrfToken, {
    workingDirectory: "../outside",
  });

  assert.equal(response.status, 400);
  assert.match(response.body.error, /workingDirectory must stay inside the repository/);
});

for (const initialGithubApp of [true, false]) {
  test(`public repository can be saved, edited and deployed (app configured: ${initialGithubApp})`, async () => {
    const context = await createTestContext({ initialGithubApp });
    test.after(() => context.cleanup());
    await login(context.agent, context.password);
    const csrfToken = await getDashboardCsrf(context.agent);
    const response = await createRepo(context.agent, csrfToken, {
      repository: "https://github.com/public/project.git",
    });
    assert.equal(response.status, 201);
    assert.equal(response.body.repository, "public/project");
    assert.equal(response.body.githubInstallationId, null);

    const updated = await context.agent
      .put(`/api/repos/${response.body.id}`)
      .set("X-CSRF-Token", csrfToken)
      .send({ ...response.body, publicPort: 8080 });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.githubInstallationId, null);

    const dashboard = await context.agent.get("/");
    assert.match(dashboard.text, /list="repository-suggestions"/);
    assert.doesNotMatch(dashboard.text, /access missing/);

    const targets = await context.agent.get(`/api/repos/${response.body.id}/manual-target-options`);
    assert.equal(targets.status, 200);
    for (const [manualTargetType, manualTargetValue] of [
      ["default-branch", ""],
      ["branch", "develop"],
      ["pr", "17"],
    ]) {
      const deployment = await context.agent
        .post(`/api/repos/${response.body.id}/manual-deploy`)
        .set("X-CSRF-Token", csrfToken)
        .send({ manualTargetType, manualTargetValue });
      assert.equal(deployment.status, 200);
    }
    for (const call of context.scriptRunner.calls) {
      assert.equal(call.env.GITHUB_REPO_URL, "https://github.com/public/project.git");
      assert.equal(call.env.GITHUB_INSTALLATION_TOKEN, "");
      assert.equal(call.env.GITHUB_INSTALLATION_ID, "");
    }
  });
}

test("does not save a repository when anonymous git validation fails", async () => {
  const context = await createTestContext();
  test.after(() => context.cleanup());
  context.scriptRunner.validateRepo = async () => {
    throw new Error("git ls-remote failed for private/project");
  };
  await login(context.agent, context.password);
  const csrfToken = await getDashboardCsrf(context.agent);
  const response = await createRepo(context.agent, csrfToken, { repository: "private/project" });
  assert.equal(response.status, 400);
  assert.match(response.body.error, /git ls-remote failed/);
  assert.equal((await context.agent.get("/api/repos")).body.length, 0);
});
