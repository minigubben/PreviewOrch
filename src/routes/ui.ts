import express, { type Request, type Response } from "express";

import type { AppConfig, ClientAssets, GithubAppConfig } from "../types/domain.js";
import type {
  DeploymentServiceLike,
  GithubAppStoreLike,
  RepoStoreLike,
} from "../types/services.js";
import { requireAuth } from "../lib/auth.js";
import { BRANDING } from "../lib/branding.js";
import { asyncHandler, setNoStore } from "../lib/http.js";
import { readLogTail } from "../lib/log-reader.js";

interface AllowedRepositoryOption {
  value: string;
  label: string;
  installationId: number;
  accountLogin: string;
}

function createUiRouter({
  clientAssets,
  config,
  deploymentService,
  repoStore,
  githubAppStore,
}: {
  clientAssets?: ClientAssets;
  config: AppConfig;
  deploymentService: DeploymentServiceLike;
  repoStore: RepoStoreLike;
  githubAppStore: GithubAppStoreLike;
}) {
  const router = express.Router();

  router.get(
    "/",
    requireAuth,
    asyncHandler(async (req: Request, res: Response) => {
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
        githubAppInstallUrl: githubApp?.slug ? "/github-app/install/start" : "",
        githubAppSettingsUrl: buildGithubAppSettingsUrl(githubApp),
        allowedRepositories: buildAllowedRepositories(githubApp),
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
    asyncHandler(async (_req: Request, res: Response) => {
      const githubApp = await githubAppStore.getGithubApp();
      setNoStore(res);
      return res.render("partials/repo-config", {
        repos: await repoStore.list(),
        githubApp,
        allowedRepositories: buildAllowedRepositories(githubApp),
      });
    }),
  );

  router.get(
    "/ui/deployments",
    requireAuth,
    asyncHandler(async (_req: Request, res: Response) => {
      setNoStore(res);
      return res.render("partials/deployments-panel", {
        deployments: await deploymentService.listDeployments(),
      });
    }),
  );

  return router;
}

function getStatusMessage(status: unknown): string {
  if (status === "github-app-created") {
    return "GitHub App created. Install it on the repos you want PreviewOrch to manage.";
  }
  if (status === "github-app-installation-updated") {
    return "GitHub App installation access refreshed.";
  }
  return "";
}

function buildAllowedRepositories(githubApp: GithubAppConfig | null): AllowedRepositoryOption[] {
  return (githubApp?.installations || [])
    .flatMap((installation) =>
      installation.repositories.map((repository) => ({
        value: repository.fullName,
        label: repository.fullName,
        installationId: installation.id,
        accountLogin: installation.accountLogin || "",
      })),
    )
    .sort((left, right) => left.label.localeCompare(right.label));
}

function buildGithubAppSettingsUrl(githubApp: GithubAppConfig | null): string {
  if (!githubApp?.slug) {
    return "";
  }

  const ownerType = String(githubApp.ownerType || "").toLowerCase();
  if (ownerType === "organization" && githubApp.ownerLogin) {
    return `https://github.com/organizations/${encodeURIComponent(githubApp.ownerLogin)}/settings/apps/${encodeURIComponent(githubApp.slug)}`;
  }

  return `https://github.com/settings/apps/${encodeURIComponent(githubApp.slug)}`;
}

export { createUiRouter };
