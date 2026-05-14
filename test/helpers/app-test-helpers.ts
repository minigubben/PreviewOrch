// @ts-nocheck
import assert from "node:assert/strict";

function invoke(agent, method, url) {
  return agent[method](url);
}

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

async function waitFor(check, { timeoutMs = 2000, intervalMs = 20 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;

  while (Date.now() < deadline) {
    try {
      return await check();
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }

  throw lastError || new Error("Timed out waiting for condition.");
}

async function waitForDeployment(
  agent,
  expectedDeploymentId,
  { timeoutMs = 2000, intervalMs = 20 } = {},
) {
  return waitFor(
    async () => {
      const response = await agent.get("/api/deployments");
      assert.equal(response.status, 200);
      const deployment = response.body.find((item) => item.deploymentId === expectedDeploymentId);
      assert.ok(deployment, `Missing deployment ${expectedDeploymentId}`);
      assert.equal(deployment.status, "running");
      return deployment;
    },
    { timeoutMs, intervalMs },
  );
}

export { createRepo, invoke, waitFor, waitForDeployment };
