// @ts-nocheck
import express from "express";

import { requireAuth, verifyCsrfToken } from "../lib/auth.js";
import { asyncHandler } from "../lib/http.js";

function createApiRouter({ deploymentService, repoStore, sshKeyManager }) {
  const router = express.Router();

  router.get(
    "/api/repos",
    requireAuth,
    asyncHandler(async (req, res) => {
      res.json(await repoStore.list());
    }),
  );

  router.post(
    "/api/repos",
    requireAuth,
    verifyCsrfToken,
    asyncHandler(async (req, res) => {
      const repo = await repoStore.create(req.body);
      res.status(201).json(repo);
    }),
  );

  router.put(
    "/api/repos/:id",
    requireAuth,
    verifyCsrfToken,
    asyncHandler(async (req, res) => {
      const repo = await repoStore.update(req.params.id, req.body);
      res.json(repo);
    }),
  );

  router.delete(
    "/api/repos/:id",
    requireAuth,
    verifyCsrfToken,
    asyncHandler(async (req, res) => {
      const activeDeployments = await deploymentService.listDeployments();
      if (activeDeployments.some((deployment) => deployment.repoId === req.params.id)) {
        return res.status(409).json({ error: "Destroy active deployments before deleting the repository." });
      }

      const removed = await repoStore.remove(req.params.id);
      if (!removed) {
        return res.status(404).json({ error: "Repository not found." });
      }
      return res.status(204).end();
    }),
  );

  router.get(
    "/api/deployments",
    requireAuth,
    asyncHandler(async (req, res) => {
      res.json(await deploymentService.listDeployments());
    }),
  );

  router.post(
    "/api/ssh-keypair",
    requireAuth,
    verifyCsrfToken,
    asyncHandler(async (req, res) => {
      const status = await sshKeyManager.generateOrRotate();
      res.json(status);
    }),
  );

  router.post(
    "/api/repos/:id/manual-deploy",
    requireAuth,
    verifyCsrfToken,
    asyncHandler(async (req, res) => {
      const deployment = await deploymentService.deployManualTarget({
        repoId: req.params.id,
        manualTargetType: req.body.manualTargetType,
        manualTargetValue: req.body.manualTargetValue,
      });
      res.json(deployment);
    }),
  );

  router.get(
    "/api/repos/:id/manual-target-options",
    requireAuth,
    asyncHandler(async (req, res) => {
      const options = await deploymentService.listManualTargets(req.params.id);
      res.json(options);
    }),
  );

  router.post(
    "/api/deployments/:id/redeploy",
    requireAuth,
    verifyCsrfToken,
    asyncHandler(async (req, res) => {
      const deployment = await deploymentService.redeployById(req.params.id);
      res.json(deployment);
    }),
  );

  router.delete(
    "/api/deployments/:id",
    requireAuth,
    verifyCsrfToken,
    asyncHandler(async (req, res) => {
      const result = await deploymentService.destroyById(req.params.id);
      res.json(result);
    }),
  );

  return router;
}

export {
  createApiRouter,
};
