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
  assert.equal(response.body.previewHostEnvVarName, "");
  assert.equal(response.body.workingDirectory, ".");
  assert.equal(response.body.prDeploymentAccess, "anyone");
  assert.deepEqual(response.body.prDeploymentAllowedLogins, []);
  assert.equal(context.scriptRunner.calls.filter((call) => call.scriptName === "validate-repo.sh").length, 1);
});

test("derives owner and repo name from the clone url", async () => {
  const context = await createTestContext();
  test.after(() => context.cleanup());

  await login(context.agent, context.password);
  const csrfToken = await getDashboardCsrf(context.agent);
  const response = await createRepo(context.agent, csrfToken, {
    owner: "wrong-owner",
    name: "wrong-name",
    cloneSshUrl: "git@github.com:ExtronicElektronik/simcards.git",
  });

  assert.equal(response.status, 201);
  assert.equal(response.body.owner, "ExtronicElektronik");
  assert.equal(response.body.name, "simcards");
  assert.equal(response.body.slug, "extronicelektronik-simcards");
});

test("stores additional env vars and preview host alias from the admin ui", async () => {
  const context = await createTestContext();
  test.after(() => context.cleanup());

  await login(context.agent, context.password);
  const csrfToken = await getDashboardCsrf(context.agent);
  const response = await createRepo(context.agent, csrfToken, {
    previewHostEnvVarName: "APP_FQDN",
    extraEnvText: "NODE_ENV=production\nAPI_ORIGIN=https://api.example.com",
  });

  assert.equal(response.status, 201);
  assert.equal(response.body.previewHostEnvVarName, "APP_FQDN");
  assert.deepEqual(response.body.extraEnv, {
    NODE_ENV: "production",
    API_ORIGIN: "https://api.example.com",
  });
  assert.equal(response.body.extraEnvText, "NODE_ENV=production\nAPI_ORIGIN=https://api.example.com");
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
  const response = await createRepo(context.agent, csrfToken, { composePath: "missing-compose.yml" });

  assert.equal(response.status, 400);
  assert.match(response.body.error, /Compose file does not exist/);
});

test("rejects a repository missing the traefik label contract", async () => {
  const context = await createTestContext();
  test.after(() => context.cleanup());

  await login(context.agent, context.password);
  const csrfToken = await getDashboardCsrf(context.agent);
  const response = await createRepo(context.agent, csrfToken, { composePath: "missing-labels.yml" });

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
