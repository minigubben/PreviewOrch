// @ts-nocheck
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

import { createRepo, waitFor } from "./helpers/app-test-helpers.js";
import { buildPullRequestPayload, createTestContext, getDashboardCsrf, login, signPayload } from "./helpers/test-app.js";

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

  assert.equal(response.status, 202);

  const envFilePath = path.join(context.config.deploymentsDir, "acme-widgets", "pr-17", ".env.runtime");
  const envFile = await waitFor(async () => fs.readFile(envFilePath, "utf8"));
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

  assert.equal(response.status, 202);

  const metadataPath = path.join(context.config.deploymentsDir, "acme-widgets", "pr-17", "deployment.json");
  const metadata = await waitFor(async () => {
    const value = JSON.parse(await fs.readFile(metadataPath, "utf8"));
    assert.equal(value.status, "running");
    assert.equal(value.appendProxySettings, true);
    assert.match(value.proxyOverridePath, /\.orchestrator-proxy\.override\.yml$/);
    return value;
  });
  assert.equal(metadata.appendProxySettings, true);
  assert.match(metadata.proxyOverridePath, /\.orchestrator-proxy\.override\.yml$/);

  const overrideFile = await fs.readFile(metadata.proxyOverridePath, "utf8");
  assert.match(overrideFile, /traefik\.enable: "true"/);
  assert.match(overrideFile, /traefik\.docker\.network: preview-proxy/);
  assert.match(overrideFile, /traefik\.http\.routers\.acme-widgets-pr-17\.rule: Host\(`acme-widgets-pr-17\.preview\.example\.com`\)/);
  assert.match(overrideFile, /traefik\.http\.services\.acme-widgets-pr-17\.loadbalancer\.server\.port: "3000"/);
  assert.doesNotMatch(overrideFile, /networks:\s+preview-proxy:\s+null/);
  assert.doesNotMatch(overrideFile, /preview-proxy:\s+[\s\S]*external: true/);
  assert.doesNotMatch(overrideFile, /preview-proxy:\s+[\s\S]*name: preview-proxy/);
});

test("resolves compose paths from the configured working directory", async () => {
  const context = await createTestContext();
  test.after(() => context.cleanup());

  await login(context.agent, context.password);
  const csrfToken = await getDashboardCsrf(context.agent);
  const repoResponse = await createRepo(context.agent, csrfToken, {
    workingDirectory: "ops/preview",
    composePath: "docker-compose.preview.yml",
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

  assert.equal(response.status, 202);

  const metadataPath = path.join(context.config.deploymentsDir, "acme-widgets", "pr-17", "deployment.json");
  const metadata = await waitFor(async () => {
    const value = JSON.parse(await fs.readFile(metadataPath, "utf8"));
    assert.equal(value.status, "running");
    assert.equal(value.workingDirectory, "ops/preview");
    assert.match(value.projectDirectoryResolved, /acme-widgets\/pr-17\/ops\/preview$/);
    assert.match(value.composePathResolved, /acme-widgets\/pr-17\/ops\/preview\/docker-compose\.preview\.yml$/);
    return value;
  });
  assert.equal(metadata.workingDirectory, "ops/preview");
  assert.match(metadata.projectDirectoryResolved, /acme-widgets\/pr-17\/ops\/preview$/);
  assert.match(metadata.composePathResolved, /acme-widgets\/pr-17\/ops\/preview\/docker-compose\.preview\.yml$/);
});
