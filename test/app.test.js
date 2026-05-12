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

test("adds a repository with valid configuration", async () => {
  const context = await createTestContext();
  test.after(() => context.cleanup());

  await login(context.agent, context.password);
  const csrfToken = await getDashboardCsrf(context.agent);
  const response = await createRepo(context.agent, csrfToken);

  assert.equal(response.status, 201);
  assert.equal(response.body.owner, "acme");
  assert.equal(response.body.name, "widgets");
  assert.equal(context.scriptRunner.calls.filter((call) => call.scriptName === "validate-repo.sh").length, 1);
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
