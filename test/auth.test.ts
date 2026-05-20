// @ts-nocheck
import assert from "node:assert/strict";
import test from "node:test";
import request from "supertest";

import { createRepo, invoke } from "./helpers/app-test-helpers.js";
import { createTestContext, getDashboardCsrf, login } from "./helpers/test-app.js";

test("all admin api endpoints reject anonymous requests", async () => {
  const context = await createTestContext();
  test.after(() => context.cleanup());

  const routes = [
    ["get", "/api/repos"],
    ["post", "/api/repos"],
    ["put", "/api/repos/test-repo"],
    ["delete", "/api/repos/test-repo"],
    ["get", "/api/deployments"],
    ["get", "/api/repos/test-repo/manual-target-options"],
    ["post", "/api/github-app/manifest"],
    ["post", "/api/github-app/installations/refresh"],
    ["post", "/api/repos/test-repo/manual-deploy"],
    ["post", "/api/deployments/test-deployment/redeploy"],
    ["delete", "/api/deployments/test-deployment"],
  ];

  for (const [method, url] of routes) {
    const response = await invoke(request(context.app), method, url).send({});
    assert.equal(
      response.status,
      401,
      `${method.toUpperCase()} ${url} should require authentication`,
    );
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
    ["post", "/api/github-app/manifest"],
    ["post", "/api/github-app/installations/refresh"],
    ["post", "/api/repos/test-repo/manual-deploy"],
    ["post", "/api/deployments/test-deployment/redeploy"],
    ["delete", "/api/deployments/test-deployment"],
  ];

  for (const [method, url] of routes) {
    const response = await invoke(context.agent, method, url).send({});
    assert.equal(
      response.status,
      403,
      `${method.toUpperCase()} ${url} should require a CSRF token`,
    );
    assert.equal(response.body.error, "Invalid CSRF token.");
  }
});

test("rejects invalid admin credentials", async () => {
  const context = await createTestContext();
  test.after(() => context.cleanup());

  const csrfToken = await context.agent
    .get("/login")
    .then((response) => response.text.match(/name="_csrf" value="([^"]+)"/)[1]);
  const response = await context.agent.post("/login").type("form").send({
    username: "admin",
    password: "wrong-password",
    _csrf: csrfToken,
  });

  assert.equal(response.status, 401);
  assert.match(response.text, /Invalid username or password/);
});

test("dashboard shows GitHub App creation state before configuration", async () => {
  const context = await createTestContext({ initialGithubApp: false });
  test.after(() => context.cleanup());

  await login(context.agent, context.password);
  const response = await context.agent.get("/");

  assert.equal(response.status, 200);
  assert.match(response.text, /No GitHub App has been created yet/);
  assert.match(response.text, /Create GitHub App/);
});

test("GitHub App manifest can target an organization owner", async () => {
  const context = await createTestContext({ initialGithubApp: false });
  test.after(() => context.cleanup());

  await login(context.agent, context.password);
  const csrfToken = await getDashboardCsrf(context.agent);
  const response = await context.agent
    .post("/api/github-app/manifest")
    .set("X-CSRF-Token", csrfToken)
    .send({
      organizationLogin: "acme-org",
    });

  assert.equal(response.status, 200);
  assert.match(
    response.text,
    /https:\/\/github\.com\/organizations\/acme-org\/settings\/apps\/new/,
  );
});

test("dashboard shows configured GitHub App state and refresh controls", async () => {
  const context = await createTestContext();
  test.after(() => context.cleanup());

  await login(context.agent, context.password);
  const dashboard = await context.agent.get("/");
  assert.match(dashboard.text, /Open installation flow/);
  assert.match(dashboard.text, /Refresh GitHub access/);
  assert.match(dashboard.text, /Configure repo access/);
  assert.match(dashboard.text, /Upload logo on GitHub/);
});

test("GitHub App OAuth callback rejects missing or invalid state", async () => {
  const context = await createTestContext();
  test.after(() => context.cleanup());

  await login(context.agent, context.password);

  const missingState = await context.agent.get("/github-app/oauth/callback?code=fake-code");
  assert.equal(missingState.status, 400);
  assert.match(missingState.text, /Invalid GitHub OAuth state/);

  await context.agent.get("/");
  const invalidState = await context.agent.get(
    "/github-app/oauth/callback?code=fake-code&state=wrong-state",
  );
  assert.equal(invalidState.status, 400);
  assert.match(invalidState.text, /Invalid GitHub OAuth state/);
});

test("GitHub App OAuth callback accepts valid state once", async () => {
  const context = await createTestContext();
  test.after(() => context.cleanup());

  await login(context.agent, context.password);
  const dashboard = await context.agent.get("/");
  const stateMatch = dashboard.text.match(/\/installations\/new\?state=([a-f0-9]+)/i);
  assert.ok(stateMatch, "expected installation flow state in dashboard link");

  const state = stateMatch[1];
  const first = await context.agent.get(
    `/github-app/oauth/callback?code=fake-code&state=${encodeURIComponent(state)}`,
  );
  assert.equal(first.status, 302);
  assert.equal(first.headers.location, "/?status=github-app-installation-updated");

  const replay = await context.agent.get(
    `/github-app/oauth/callback?code=fake-code&state=${encodeURIComponent(state)}`,
  );
  assert.equal(replay.status, 400);
  assert.match(replay.text, /Invalid GitHub OAuth state/);
});

test("allows login in production mode when session cookie secure is auto", async () => {
  const context = await createTestContext({
    nodeEnv: "production",
    sessionCookieSecure: "auto",
  });
  test.after(() => context.cleanup());

  const csrfToken = await context.agent
    .get("/login")
    .then((response) => response.text.match(/name="_csrf" value="([^"]+)"/)[1]);
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
