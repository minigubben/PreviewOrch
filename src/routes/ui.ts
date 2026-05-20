// @ts-nocheck
import express from "express";

import { requireAuth } from "../lib/auth.js";
import { BRANDING } from "../lib/branding.js";
import { asyncHandler, setNoStore } from "../lib/http.js";
import { readLogTail } from "../lib/log-reader.js";
import { buildInstallUrl } from "../lib/github-installation-resolver.js";

function createUiRouter({ clientAssets, config, deploymentService, repoStore, githubAppStore }) {
  const router = express.Router();

  router.get(
    "/",
    requireAuth,
    asyncHandler(async (req, res) => {
      const [repos, deployments, eventsLog, githubApp] = await Promise.all([
        repoStore.list(),
        deploymentService.listDeployments(),
        readLogTail(config.appLogFile, 60),
        githubAppStore.getGithubApp(),
      ]);

      setNoStore(res);
      return res.render("dashboard", {
        repos,
        deployments,
        appLogTail: eventsLog,
        githubApp,
        githubAppInstallUrl: buildInstallUrl(githubApp?.slug),
        clientAssets,
        brand: BRANDING,
        baseDomain: config.baseDomain,
        traefikNetworkName: config.traefikNetworkName,
        apiBase: "/api",
        statusMessage: getStatusMessage(req.query.status),
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
        githubApp: await githubAppStore.getGithubApp(),
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

export { createUiRouter };

function getStatusMessage(status) {
  if (status === "github-app-created") {
    return "GitHub App created. Install it on the repos you want PreviewOrch to manage.";
  }
  if (status === "github-app-installation-updated") {
    return "GitHub App installation access refreshed.";
  }
  return "";
}
