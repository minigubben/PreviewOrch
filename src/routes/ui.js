const express = require("express");

const { requireAuth } = require("../lib/auth");
const { asyncHandler, setNoStore } = require("../lib/http");
const { readLogTail } = require("../lib/log-reader");

function createUiRouter({ assetVersion, config, deploymentService, repoStore, sshKeyManager }) {
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
        assetVersion,
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

module.exports = {
  createUiRouter,
};
