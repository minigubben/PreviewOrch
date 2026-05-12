// @ts-nocheck
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

import { buildDeploymentKey, buildPreviewHost, buildProjectName } from "../src/lib/utils.js";
import { mapPullRequestAction, normalizeWebhookSecret, verifyGithubSignature } from "../src/lib/github.js";
import { buildPullRequestPayload, signPayload } from "./helpers/test-app.js";

test("buildPreviewHost creates the expected wildcard host", () => {
  assert.equal(buildPreviewHost("acme-widgets", "pr-42", "preview.example.com"), "acme-widgets-pr-42.preview.example.com");
});

test("buildProjectName creates a docker-safe project name", () => {
  assert.equal(buildProjectName("acme-widgets", "pr-42"), "acme-widgets-pr-42");
});

test("buildDeploymentKey supports branches and pull requests", () => {
  assert.equal(buildDeploymentKey("pr", 42), "pr-42");
  assert.equal(buildDeploymentKey("branch", "feature/Test Branch"), "branch-feature-test-branch");
});

test("verifyGithubSignature accepts a valid signature", () => {
  const payload = buildPullRequestPayload("opened");
  const { raw, signature } = signPayload("webhook-secret", payload);
  assert.equal(verifyGithubSignature(Buffer.from(raw), signature, "webhook-secret"), true);
});

test("verifyGithubSignature rejects an invalid signature", () => {
  const payload = buildPullRequestPayload("opened");
  const { raw } = signPayload("webhook-secret", payload);
  assert.equal(verifyGithubSignature(Buffer.from(raw), "sha256=bad", "webhook-secret"), false);
});

test("verifyGithubSignature accepts a quoted webhook secret", () => {
  const payload = buildPullRequestPayload("opened");
  const { raw, signature } = signPayload("webhook-secret", payload);
  assert.equal(verifyGithubSignature(Buffer.from(raw), signature, "'webhook-secret'"), true);
});

test("verifyGithubSignature accepts a legacy sha1 signature header", () => {
  const payload = buildPullRequestPayload("opened");
  const raw = JSON.stringify(payload);
  const digest = crypto.createHmac("sha1", "webhook-secret").update(raw).digest("hex");
  assert.equal(verifyGithubSignature(Buffer.from(raw), `sha1=${digest}`, "webhook-secret"), true);
});

test("normalizeWebhookSecret strips matching surrounding quotes", () => {
  assert.equal(normalizeWebhookSecret("'abc123'"), "abc123");
  assert.equal(normalizeWebhookSecret('"abc123"'), "abc123");
  assert.equal(normalizeWebhookSecret("abc123"), "abc123");
});

test("mapPullRequestAction matches the supported lifecycle events", () => {
  assert.equal(mapPullRequestAction("opened"), "deploy");
  assert.equal(mapPullRequestAction("reopened"), "deploy");
  assert.equal(mapPullRequestAction("synchronize"), "deploy");
  assert.equal(mapPullRequestAction("closed"), "destroy");
  assert.equal(mapPullRequestAction("labeled"), null);
});
