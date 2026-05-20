// @ts-nocheck
import express from "express";
import crypto from "node:crypto";

import { requireAuth, verifyCsrfToken } from "../lib/auth.js";
import { BRANDING } from "../lib/branding.js";
import { asyncHandler } from "../lib/http.js";

function createGithubAppRouter({
  config,
  githubAppClient,
  githubAppStore,
  githubInstallationResolver,
}) {
  const router = express.Router();

  router.post(
    "/api/github-app/manifest",
    requireAuth,
    verifyCsrfToken,
    asyncHandler(async (req, res) => {
      const state = crypto.randomBytes(24).toString("hex");
      const organizationLogin = normalizeOrganizationLogin(req.body.organizationLogin);
      req.session.githubAppManifestState = state;
      req.session.githubAppManifestOwnerType = organizationLogin ? "organization" : "user";
      const manifest = githubAppClient.buildManifest({
        orchestratorPublicUrl: config.orchestratorPublicUrl,
        appName: BRANDING.name,
      });

      res.type("html");
      res.send(
        renderAutoSubmitHtml({
          action: buildManifestActionUrl({ state, organizationLogin }),
          manifest,
        }),
      );
    }),
  );

  router.get(
    "/github-app/manifest/callback",
    asyncHandler(async (req, res) => {
      const code = String(req.query.code || "").trim();
      const state = String(req.query.state || "").trim();
      if (!code || !state || state !== req.session.githubAppManifestState) {
        return res.status(400).send("Invalid GitHub App manifest state.");
      }

      const converted = await githubAppClient.convertManifestCode(code);
      req.session.githubAppManifestState = null;

      await githubAppStore.saveGithubApp({
        appId: converted.id,
        clientId: converted.client_id,
        clientSecret: converted.client_secret,
        privateKeyPem: converted.pem,
        webhookSecret: converted.webhook_secret,
        slug: converted.slug,
        name: converted.name,
        ownerLogin: converted.owner?.login || "",
        ownerType: converted.owner?.type || req.session.githubAppManifestOwnerType || "User",
        installations: [],
      });

      req.session.githubAppManifestOwnerType = null;
      return res.redirect("/?status=github-app-created");
    }),
  );

  router.get(
    "/github-app/oauth/callback",
    asyncHandler(async (req, res) => {
      const code = String(req.query.code || "").trim();
      if (!code) {
        return res.status(400).send("Missing GitHub OAuth code.");
      }

      const githubApp = await githubAppStore.getGithubApp();
      if (!githubApp?.clientId || !githubApp?.clientSecret) {
        return res.status(400).send("GitHub App is not configured.");
      }

      const tokenResponse = await githubAppClient.exchangeOAuthCode({
        clientId: githubApp.clientId,
        clientSecret: githubApp.clientSecret,
        code,
        redirectUri: `${config.orchestratorPublicUrl}/github-app/oauth/callback`,
      });

      await githubInstallationResolver.refreshInstallationsForUserToken(
        String(tokenResponse.access_token || ""),
      );

      return res.redirect("/?status=github-app-installation-updated");
    }),
  );

  router.post(
    "/api/github-app/installations/refresh",
    requireAuth,
    verifyCsrfToken,
    asyncHandler(async (req, res) => {
      const githubApp = await githubInstallationResolver.refreshInstallationsUsingApp();
      res.json({
        ok: true,
        installationCount: githubApp?.installations?.length || 0,
      });
    }),
  );

  return router;
}

function renderAutoSubmitHtml({ action, manifest }) {
  const manifestValue = JSON.stringify(manifest);
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Create GitHub App</title>
  </head>
  <body>
    <form id="manifest-form" action="${escapeAttribute(action)}" method="post">
      <input type="hidden" name="manifest" value="${escapeAttribute(manifestValue)}" />
    </form>
    <script>document.getElementById("manifest-form").submit();</script>
  </body>
</html>`;
}

function escapeAttribute(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export { createGithubAppRouter };

function buildManifestActionUrl({ state, organizationLogin }) {
  const baseUrl = organizationLogin
    ? `https://github.com/organizations/${encodeURIComponent(organizationLogin)}/settings/apps/new`
    : "https://github.com/settings/apps/new";
  return `${baseUrl}?state=${encodeURIComponent(state)}`;
}

function normalizeOrganizationLogin(value) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return "";
  }

  if (!/^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$/i.test(normalized)) {
    const error = new Error("organizationLogin must be a valid GitHub organization login.");
    error.statusCode = 400;
    throw error;
  }

  return normalized;
}
