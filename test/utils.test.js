const test = require("node:test");
const assert = require("node:assert/strict");

const { buildDeploymentKey, buildPreviewHost, buildProjectName } = require("../src/lib/utils");
const { mapPullRequestAction, verifyGithubSignature } = require("../src/lib/github");
const { buildPullRequestPayload, signPayload } = require("./helpers/test-app");

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

test("mapPullRequestAction matches the supported lifecycle events", () => {
  assert.equal(mapPullRequestAction("opened"), "deploy");
  assert.equal(mapPullRequestAction("reopened"), "deploy");
  assert.equal(mapPullRequestAction("synchronize"), "deploy");
  assert.equal(mapPullRequestAction("closed"), "destroy");
  assert.equal(mapPullRequestAction("labeled"), null);
});
