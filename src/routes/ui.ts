// @ts-nocheck
import express from "express";

import { requireAuth } from "../lib/auth.js";
import { BRANDING } from "../lib/branding.js";
import { asyncHandler, setNoStore } from "../lib/http.js";
import { readLogTail } from "../lib/log-reader.js";

function createUiRouter({ clientAssets, config, deploymentService, repoStore, sshKeyManager }) {
  const router = express.Router();

  router.get(
    "/",
    requireAuth,
    asyncHandler(async (req, res) => {
      const [repos, deployments, eventsLog, sshKeyStatus] = await Promise.all([
        repoStore.list(),
        deploymentService.listDeployments(),
        readLogTail(config.appLogFile, 60),
        sshKeyManager.getStatus(),
      ]);

      setNoStore(res);
      return res.render("dashboard", {
        repos,
        deployments,
        appLogTail: eventsLog,
        sshKeyStatus,
        clientAssets,
        brand: BRANDING,
        baseDomain: config.baseDomain,
        traefikNetworkName: config.traefikNetworkName,
        apiBase: "/api",
      });
    }),
  );

  router.get(
    "/ui/repo-config",
    requireAuth,
    asyncHandler(async (req, res) => {
      setNoStore(res);
      return res.render("partials/repo-config", {
        repos: await repoStore.list(),
      });
    }),
  );

  router.get(
    "/ui/deployments",
    requireAuth,
    asyncHandler(async (req, res) => {
      setNoStore(res);
      return res.render("partials/deployments-panel", {
        deployments: await deploymentService.listDeployments(),
      });
    }),
  );

  return router;
}

export {
  createUiRouter,
};
