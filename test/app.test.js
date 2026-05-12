const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs/promises");
const path = require("path");
const request = require("supertest");

const {
  buildPullRequestPayload,
  createTestContext,
  getDashboardCsrf,
  login,
  signPayload,
} = require("./helpers/test-app");

async function createRepo(agent, csrfToken, overrides = {}) {
  const response = await agent
    .post("/api/repos")
    .set("X-CSRF-Token", csrfToken)
    .send({
      owner: "acme",
      name: "widgets",
      cloneSshUrl: "git@github.com:acme/widgets.git",
      composePath: "deploy/preview-compose.yml",
      publicService: "app",
      publicPort: 3000,
      defaultBranch: "main",
      enabled: true,
      ...overrides,
    });

  return response;
}

test("rejects invalid admin credentials", async () => {
  const context = await createTestContext();
  test.after(() => context.cleanup());

  const csrfToken = await context.agent.get("/login").then((response) => response.text.match(/name="_csrf" value="([^"]+)"/)[1]);
  const response = await context.agent.post("/login").type("form").send({
    username: "admin",
    password: "wrong-password",
    _csrf: csrfToken,
  });

  assert.equal(response.status, 401);
  assert.match(response.text, /Invalid username or password/);
});

test("dashboard shows missing ssh key state before generation", async () => {
  const context = await createTestContext();
  test.after(() => context.cleanup());

  await login(context.agent, context.password);
  const response = await context.agent.get("/");

  assert.equal(response.status, 200);
  assert.match(response.text, /No SSH keypair exists yet/);
  assert.match(response.text, /Generate SSH keypair/);
});

test("admin can generate an ssh keypair from the ui api", async () => {
  const context = await createTestContext();
  test.after(() => context.cleanup());

  await login(context.agent, context.password);
  const csrfToken = await getDashboardCsrf(context.agent);
  const response = await context.agent.post("/api/ssh-keypair").set("X-CSRF-Token", csrfToken).send({});

  assert.equal(response.status, 200);
  assert.equal(response.body.hasKey, true);
  assert.equal(response.body.algorithm, "ed25519");
  assert.match(response.body.publicKey, /^ssh-ed25519 /);
  assert.equal(context.sshKeyManager.generateCalls, 1);

  const dashboard = await context.agent.get("/");
  assert.match(dashboard.text, /Rotate SSH keypair/);
  assert.match(dashboard.text, /ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFakeGeneratedKey/);
  assert.match(dashboard.text, /Generate a new keypair and replace the current one\?/);
});

test("allows login in production mode when session cookie secure is auto", async () => {
  const context = await createTestContext({
    nodeEnv: "production",
    sessionCookieSecure: "auto",
  });
  test.after(() => context.cleanup());

  const csrfToken = await context.agent.get("/login").then((response) => response.text.match(/name="_csrf" value="([^"]+)"/)[1]);
  const response = await context.agent.post("/login").type("form").send({
    username: "admin",
    password: context.password,
    _csrf: csrfToken,
  });

  assert.equal(response.status, 302);
  assert.equal(response.headers.location, "/");
});

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
  assert.equal(context.scriptRunner.calls.filter((call) => call.scriptName === "validate-repo.sh").length, 1);
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

test("deploys on pull request opened and stores deployment metadata", async () => {
  const context = await createTestContext();
  test.after(() => context.cleanup());

  await login(context.agent, context.password);
  const csrfToken = await getDashboardCsrf(context.agent);
  const repoResponse = await createRepo(context.agent, csrfToken);
  assert.equal(repoResponse.status, 201);

  const payload = buildPullRequestPayload("opened");
  const { raw, signature } = signPayload("webhook-secret", payload);
  const response = await context.agent
    .post("/webhooks/github")
    .set("X-GitHub-Event", "pull_request")
    .set("X-Hub-Signature-256", signature)
    .set("Content-Type", "application/json")
    .send(raw);

  assert.equal(response.status, 200);

  const anonymousDeployments = await request(context.app).get("/api/deployments");
  assert.equal(anonymousDeployments.status, 401);

  const authorizedDeployments = await context.agent.get("/api/deployments");
  assert.equal(authorizedDeployments.status, 200);
  assert.equal(authorizedDeployments.body.length, 1);
  assert.equal(authorizedDeployments.body[0].status, "running");

  const metadataPath = path.join(context.config.deploymentsDir, "acme-widgets", "pr-17", "deployment.json");
  const metadata = JSON.parse(await fs.readFile(metadataPath, "utf8"));
  assert.equal(metadata.previewHost, "acme-widgets-pr-17.preview.example.com");
  assert.equal(metadata.appendProxySettings, false);
  const deployCall = context.scriptRunner.calls.find((call) => call.scriptName === "deploy-pr.sh");
  assert.equal(deployCall.env.COMPOSE_BAKE, "false");
});

test("redeploys on pull request synchronize", async () => {
  const context = await createTestContext();
  test.after(() => context.cleanup());

  await login(context.agent, context.password);
  const csrfToken = await getDashboardCsrf(context.agent);
  await createRepo(context.agent, csrfToken);

  for (const action of ["opened", "synchronize"]) {
    const payload = buildPullRequestPayload(action, { prSha: action === "opened" ? "abc123" : "def456" });
    const { raw, signature } = signPayload("webhook-secret", payload);
    const response = await context.agent
      .post("/webhooks/github")
      .set("X-GitHub-Event", "pull_request")
      .set("X-Hub-Signature-256", signature)
      .set("Content-Type", "application/json")
      .send(raw);
    assert.equal(response.status, 200);
  }

  const deploymentCsrf = await getDashboardCsrf(context.agent);
  assert.ok(deploymentCsrf);
  const deployments = await context.agent.get("/api/deployments");
  assert.equal(deployments.body.length, 1);
  assert.equal(deployments.body[0].prSha, "def456");
  assert.equal(context.scriptRunner.calls.filter((call) => call.scriptName === "deploy-pr.sh").length, 2);
});

test("writes the preview host alias and extra env vars into the deployment env file", async () => {
  const context = await createTestContext();
  test.after(() => context.cleanup());

  await login(context.agent, context.password);
  const csrfToken = await getDashboardCsrf(context.agent);
  const repoResponse = await createRepo(context.agent, csrfToken, {
    previewHostEnvVarName: "APP_FQDN",
    extraEnvText: "NODE_ENV=production\nAPI_ORIGIN=https://api.example.com",
  });
  assert.equal(repoResponse.status, 201);

  const payload = buildPullRequestPayload("opened");
  const { raw, signature } = signPayload("webhook-secret", payload);
  const response = await context.agent
    .post("/webhooks/github")
    .set("X-GitHub-Event", "pull_request")
    .set("X-Hub-Signature-256", signature)
    .set("Content-Type", "application/json")
    .send(raw);

  assert.equal(response.status, 200);

  const envFilePath = path.join(context.config.deploymentsDir, "acme-widgets", "pr-17", ".env.runtime");
  const envFile = await fs.readFile(envFilePath, "utf8");
  assert.match(envFile, /^ORCH_PREVIEW_HOST=acme-widgets-pr-17\.preview\.example\.com$/m);
  assert.match(envFile, /^APP_FQDN=acme-widgets-pr-17\.preview\.example\.com$/m);
  assert.match(envFile, /^NODE_ENV=production$/m);
  assert.match(envFile, /^API_ORIGIN=https:\/\/api\.example\.com$/m);
});

test("stores a generated proxy override path when proxy settings are appended", async () => {
  const context = await createTestContext();
  test.after(() => context.cleanup());

  await login(context.agent, context.password);
  const csrfToken = await getDashboardCsrf(context.agent);
  const repoResponse = await createRepo(context.agent, csrfToken, {
    composePath: "missing-labels.yml",
    appendProxySettings: true,
  });
  assert.equal(repoResponse.status, 201);

  const payload = buildPullRequestPayload("opened");
  const { raw, signature } = signPayload("webhook-secret", payload);
  const response = await context.agent
    .post("/webhooks/github")
    .set("X-GitHub-Event", "pull_request")
    .set("X-Hub-Signature-256", signature)
    .set("Content-Type", "application/json")
    .send(raw);

  assert.equal(response.status, 200);

  const metadataPath = path.join(context.config.deploymentsDir, "acme-widgets", "pr-17", "deployment.json");
  const metadata = JSON.parse(await fs.readFile(metadataPath, "utf8"));
  assert.equal(metadata.appendProxySettings, true);
  assert.match(metadata.proxyOverridePath, /\.orchestrator-proxy\.override\.yml$/);
});

test("manually deploys a branch from the repo editor api", async () => {
  const context = await createTestContext();
  test.after(() => context.cleanup());

  await login(context.agent, context.password);
  const csrfToken = await getDashboardCsrf(context.agent);
  const repoResponse = await createRepo(context.agent, csrfToken);
  assert.equal(repoResponse.status, 201);

  const response = await context.agent
    .post(`/api/repos/${repoResponse.body.id}/manual-deploy`)
    .set("X-CSRF-Token", csrfToken)
    .send({
      manualTargetType: "branch",
      manualTargetValue: "release/2026-q2",
    });

  assert.equal(response.status, 200);
  assert.equal(response.body.targetType, "branch");
  assert.equal(response.body.targetValue, "release/2026-q2");
  assert.equal(response.body.deploymentKey, "branch-release-2026-q2");
  assert.equal(response.body.previewHost, "acme-widgets-branch-release-2026-q2.preview.example.com");

  const dashboard = await context.agent.get("/");
  assert.equal(dashboard.status, 200);
  assert.match(dashboard.text, /Branch release\/2026-q2/);
});

test("manually deploys a pull request from the repo editor api", async () => {
  const context = await createTestContext();
  test.after(() => context.cleanup());

  await login(context.agent, context.password);
  const csrfToken = await getDashboardCsrf(context.agent);
  const repoResponse = await createRepo(context.agent, csrfToken);
  assert.equal(repoResponse.status, 201);

  const response = await context.agent
    .post(`/api/repos/${repoResponse.body.id}/manual-deploy`)
    .set("X-CSRF-Token", csrfToken)
    .send({
      manualTargetType: "pr",
      manualTargetValue: 27,
    });

  assert.equal(response.status, 200);
  assert.equal(response.body.targetType, "pr");
  assert.equal(response.body.targetValue, 27);
  assert.equal(response.body.deploymentKey, "pr-27");
  assert.equal(response.body.previewHost, "acme-widgets-pr-27.preview.example.com");
});

test("destroys deployments and cleans the work directory on pull request close", async () => {
  const context = await createTestContext();
  test.after(() => context.cleanup());

  await login(context.agent, context.password);
  const csrfToken = await getDashboardCsrf(context.agent);
  await createRepo(context.agent, csrfToken);

  for (const action of ["opened", "closed"]) {
    const payload = buildPullRequestPayload(action);
    const { raw, signature } = signPayload("webhook-secret", payload);
    const response = await context.agent
      .post("/webhooks/github")
      .set("X-GitHub-Event", "pull_request")
      .set("X-Hub-Signature-256", signature)
      .set("Content-Type", "application/json")
      .send(raw);
    assert.equal(response.status, 200);
  }

  const deploymentDir = path.join(context.config.deploymentsDir, "acme-widgets", "pr-17");
  await assert.rejects(fs.access(deploymentDir));

  const deployments = await context.agent.get("/api/deployments");
  assert.equal(deployments.status, 200);
  assert.equal(deployments.body.length, 0);
});

test("handles duplicate webhook deliveries without corrupting deployment state", async () => {
  const context = await createTestContext({ deployDelayMs: 50 });
  test.after(() => context.cleanup());

  await login(context.agent, context.password);
  const csrfToken = await getDashboardCsrf(context.agent);
  await createRepo(context.agent, csrfToken);

  const payload = buildPullRequestPayload("synchronize", { prSha: "dup123" });
  const { raw, signature } = signPayload("webhook-secret", payload);

  const [first, second] = await Promise.all([
    context.agent
      .post("/webhooks/github")
      .set("X-GitHub-Event", "pull_request")
      .set("X-Hub-Signature-256", signature)
      .set("Content-Type", "application/json")
      .send(raw),
    context.agent
      .post("/webhooks/github")
      .set("X-GitHub-Event", "pull_request")
      .set("X-Hub-Signature-256", signature)
      .set("Content-Type", "application/json")
      .send(raw),
  ]);

  assert.equal(first.status, 200);
  assert.equal(second.status, 200);

  const deployments = await context.agent.get("/api/deployments");
  assert.equal(deployments.status, 200);
  assert.equal(deployments.body.length, 1);
  assert.equal(deployments.body[0].status, "running");
});

test("rejects invalid webhook signatures", async () => {
  const context = await createTestContext();
  test.after(() => context.cleanup());

  const payload = buildPullRequestPayload("opened");
  const response = await context.agent
    .post("/webhooks/github")
    .set("X-GitHub-Event", "pull_request")
    .set("X-Hub-Signature-256", "sha256=invalid")
    .set("Content-Type", "application/json")
    .send(JSON.stringify(payload));

  assert.equal(response.status, 401);
  assert.equal(response.body.error, "Invalid signature.");
});

test("manual redeploy and manual delete routes work from the admin ui api", async () => {
  const context = await createTestContext();
  test.after(() => context.cleanup());

  await login(context.agent, context.password);
  const csrfToken = await getDashboardCsrf(context.agent);
  await createRepo(context.agent, csrfToken);

  const openedPayload = buildPullRequestPayload("opened");
  const signedOpened = signPayload("webhook-secret", openedPayload);
  await context.agent
    .post("/webhooks/github")
    .set("X-GitHub-Event", "pull_request")
    .set("X-Hub-Signature-256", signedOpened.signature)
    .set("Content-Type", "application/json")
    .send(signedOpened.raw);

  const deployments = await context.agent.get("/api/deployments");
  const deploymentId = deployments.body[0].deploymentId;

  const responseRedeploy = await context.agent
    .post(`/api/deployments/${deploymentId}/redeploy`)
    .set("X-CSRF-Token", csrfToken)
    .send({});
  assert.equal(responseRedeploy.status, 200);

  const responseDelete = await context.agent
    .delete(`/api/deployments/${deploymentId}`)
    .set("X-CSRF-Token", csrfToken);
  assert.equal(responseDelete.status, 200);
  assert.equal(responseDelete.body.destroyed, true);
});
