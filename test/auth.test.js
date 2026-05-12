const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");

const { createRepo, invoke } = require("./helpers/app-test-helpers");
const { createTestContext, getDashboardCsrf, login } = require("./helpers/test-app");

test("all admin api endpoints reject anonymous requests", async () => {
  const context = await createTestContext();
  test.after(() => context.cleanup());

  const routes = [
    ["get", "/api/repos"],
    ["post", "/api/repos"],
    ["put", "/api/repos/test-repo"],
    ["delete", "/api/repos/test-repo"],
    ["get", "/api/deployments"],
    ["post", "/api/ssh-keypair"],
    ["post", "/api/repos/test-repo/manual-deploy"],
    ["post", "/api/deployments/test-deployment/redeploy"],
    ["delete", "/api/deployments/test-deployment"],
  ];

  for (const [method, url] of routes) {
    const response = await invoke(request(context.app), method, url).send({});
    assert.equal(response.status, 401, `${method.toUpperCase()} ${url} should require authentication`);
    assert.equal(response.body.error, "Authentication required.");
  }
});

test("all state-changing admin api endpoints require csrf tokens after login", async () => {
  const context = await createTestContext();
  test.after(() => context.cleanup());

  await login(context.agent, context.password);

  const routes = [
    ["post", "/api/repos"],
    ["put", "/api/repos/test-repo"],
    ["delete", "/api/repos/test-repo"],
    ["post", "/api/ssh-keypair"],
    ["post", "/api/repos/test-repo/manual-deploy"],
    ["post", "/api/deployments/test-deployment/redeploy"],
    ["delete", "/api/deployments/test-deployment"],
  ];

  for (const [method, url] of routes) {
    const response = await invoke(context.agent, method, url).send({});
    assert.equal(response.status, 403, `${method.toUpperCase()} ${url} should require a CSRF token`);
    assert.equal(response.body.error, "Invalid CSRF token.");
  }
});

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

test("authenticated repo creation remains available from the admin api", async () => {
  const context = await createTestContext();
  test.after(() => context.cleanup());

  await login(context.agent, context.password);
  const csrfToken = await getDashboardCsrf(context.agent);
  const response = await createRepo(context.agent, csrfToken);

  assert.equal(response.status, 201);
  assert.equal(response.body.owner, "acme");
});
