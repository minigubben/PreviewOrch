const test = require("node:test");
const assert = require("node:assert/strict");

const { createRepo } = require("./helpers/app-test-helpers");
const { createTestContext, getDashboardCsrf, login, signPayload, buildPullRequestPayload } = require("./helpers/test-app");

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
  assert.match(dashboard.text, /acme-widgets-branch-release-2026-q2-app-1/);
  assert.match(dashboard.text, /Target Container Logs/);
  assert.match(dashboard.text, /listening on :3000/);
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
