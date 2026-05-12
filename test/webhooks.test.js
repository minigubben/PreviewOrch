const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs/promises");
const path = require("path");
const request = require("supertest");

const { createRepo, waitFor, waitForDeployment } = require("./helpers/app-test-helpers");
const { buildPullRequestPayload, createTestContext, getDashboardCsrf, login, signPayload } = require("./helpers/test-app");

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

  assert.equal(response.status, 202);

  const anonymousDeployments = await request(context.app).get("/api/deployments");
  assert.equal(anonymousDeployments.status, 401);

  const authorizedDeployments = await waitFor(async () => {
    const result = await context.agent.get("/api/deployments");
    assert.equal(result.status, 200);
    assert.equal(result.body.length, 1);
    assert.equal(result.body[0].status, "running");
    return result;
  });
  assert.equal(authorizedDeployments.body[0].runtime.publicServiceContainer.name, "acme-widgets-pr-17-app-1");
  assert.deepEqual(authorizedDeployments.body[0].runtime.publicServiceContainer.networks, ["default", "preview-proxy"]);
  assert.match(authorizedDeployments.body[0].runtime.publicServiceContainer.logTail, /listening on :3000/);

  const metadataPath = path.join(context.config.deploymentsDir, "acme-widgets", "pr-17", "deployment.json");
  const metadata = await waitFor(async () => JSON.parse(await fs.readFile(metadataPath, "utf8")));
  assert.equal(metadata.previewHost, "acme-widgets-pr-17.preview.example.com");
  assert.equal(metadata.appendProxySettings, false);
});

test("optionally publishes GitHub deployment entries and statuses with a PAT", async () => {
  const context = await createTestContext({
    githubDeploymentsToken: "github_pat_test",
  });
  test.after(() => context.cleanup());

  await login(context.agent, context.password);
  const csrfToken = await getDashboardCsrf(context.agent);
  const repoResponse = await createRepo(context.agent, csrfToken);
  assert.equal(repoResponse.status, 201);

  const payload = buildPullRequestPayload("opened", {
    repoFullName: "acme/widgets",
    prNumber: 22,
    prSha: "deadbeef",
  });
  const { raw, signature } = signPayload("webhook-secret", payload);
  const response = await context.agent
    .post("/webhooks/github")
    .set("X-GitHub-Event", "pull_request")
    .set("X-Hub-Signature-256", signature)
    .set("Content-Type", "application/json")
    .send(raw);

  assert.equal(response.status, 202);

  const deployment = await waitForDeployment(context.agent, `${repoResponse.body.id}-pr-22`);
  assert.equal(deployment.githubDeployment.id, 1000);
  assert.equal(deployment.githubDeployment.environment, "preview/pr-22");

  assert.equal(context.githubDeploymentPublisher.deployments.length, 1);
  assert.equal(context.githubDeploymentPublisher.deployments[0].owner, "acme");
  assert.equal(context.githubDeploymentPublisher.deployments[0].repo, "widgets");
  assert.equal(context.githubDeploymentPublisher.deployments[0].ref, "refs/pull/22/head");
  assert.equal(context.githubDeploymentPublisher.deployments[0].environment, "preview/pr-22");

  assert.equal(context.githubDeploymentPublisher.statuses.length, 2);
  assert.equal(context.githubDeploymentPublisher.statuses[0].state, "pending");
  assert.equal(context.githubDeploymentPublisher.statuses[1].state, "success");
  assert.equal(
    context.githubDeploymentPublisher.statuses[1].environmentUrl,
    "http://acme-widgets-pr-22.preview.example.com",
  );
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
    assert.equal(response.status, 202);
  }

  const deploymentCsrf = await getDashboardCsrf(context.agent);
  assert.ok(deploymentCsrf);
  const deployments = await waitFor(async () => {
    const result = await context.agent.get("/api/deployments");
    assert.equal(result.body.length, 1);
    assert.equal(result.body[0].prSha, "def456");
    assert.equal(result.body[0].status, "running");
    return result;
  });
  assert.equal(deployments.body.length, 1);
  assert.equal(deployments.body[0].prSha, "def456");
  await waitFor(async () => {
    assert.equal(context.scriptRunner.calls.filter((call) => call.scriptName === "deploy-pr.sh").length, 2);
  });
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
    assert.equal(response.status, 202);
  }

  const deploymentDir = path.join(context.config.deploymentsDir, "acme-widgets", "pr-17");
  await waitFor(async () => {
    await assert.rejects(fs.access(deploymentDir));
  });

  const deployments = await waitFor(async () => {
    const result = await context.agent.get("/api/deployments");
    assert.equal(result.status, 200);
    assert.equal(result.body.length, 0);
    return result;
  });
  assert.equal(deployments.status, 200);
  assert.equal(deployments.body.length, 0);
});

test("marks GitHub deployments inactive when a preview is destroyed", async () => {
  const context = await createTestContext({
    githubDeploymentsToken: "github_pat_test",
  });
  test.after(() => context.cleanup());

  await login(context.agent, context.password);
  const csrfToken = await getDashboardCsrf(context.agent);
  await createRepo(context.agent, csrfToken);

  for (const action of ["opened", "closed"]) {
    const payload = buildPullRequestPayload(action, { prNumber: 18, prSha: "bead1234" });
    const { raw, signature } = signPayload("webhook-secret", payload);
    const response = await context.agent
      .post("/webhooks/github")
      .set("X-GitHub-Event", "pull_request")
      .set("X-Hub-Signature-256", signature)
      .set("Content-Type", "application/json")
      .send(raw);
    assert.equal(response.status, 202);
  }

  await waitFor(async () => {
    const states = context.githubDeploymentPublisher.statuses.map((status) => status.state);
    assert.deepEqual(states, ["pending", "success", "inactive"]);
  });
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

  assert.equal(first.status, 202);
  assert.equal(second.status, 202);

  const deployments = await waitFor(async () => {
    const result = await context.agent.get("/api/deployments");
    assert.equal(result.status, 200);
    assert.equal(result.body.length, 1);
    assert.equal(result.body[0].status, "running");
    return result;
  }, { timeoutMs: 3000 });
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

test("accepts GitHub webhook ping events", async () => {
  const context = await createTestContext();
  test.after(() => context.cleanup());

  const payload = {
    zen: "Approachable is better than simple.",
    hook_id: 123456,
    repository: {
      full_name: "acme/widgets",
    },
  };
  const { raw, signature } = signPayload("webhook-secret", payload);

  const response = await context.agent
    .post("/webhooks/github")
    .set("X-GitHub-Event", "ping")
    .set("X-Hub-Signature-256", signature)
    .set("Content-Type", "application/json")
    .send(raw);

  assert.equal(response.status, 200);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.event, "ping");
  assert.equal(response.body.hookId, 123456);
  assert.equal(response.body.zen, "Approachable is better than simple.");
});
