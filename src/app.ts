// @ts-nocheck
import path from "node:path";
import { fileURLToPath } from "node:url";

import express from "express";
import session from "express-session";

import { loadClientAssets } from "./lib/asset-manifest.js";
import { ensureCsrfToken } from "./lib/auth.js";
import { bootstrapFilesystem } from "./lib/bootstrap.js";
import { buildAppServices } from "./lib/app-services.js";
import { RepoValidationError } from "./lib/repo-validation-error.js";
import { ScriptError } from "./lib/script-runner.js";
import { createApiRouter } from "./routes/api.js";
import { createAuthRouter } from "./routes/auth.js";
import { createGithubWebhookRouter } from "./routes/github-webhooks.js";
import { createHealthRouter } from "./routes/health.js";
import { createUiRouter } from "./routes/ui.js";
import { BRANDING } from "./lib/branding.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function createApp({ config, services = {}, clientAssets: clientAssetsOverride } = {}) {
  await bootstrapFilesystem(config);
  const appServices = buildAppServices({ config, services });
  const clientAssets =
    clientAssetsOverride ||
    (await loadClientAssets(path.join(__dirname, "public", ".vite", "manifest.json"), {
      css: [],
      js: [],
    }));

  const app = express();
  app.set("view engine", "ejs");
  app.set("views", path.join(__dirname, "views"));
  app.set("trust proxy", 1);

  app.use("/static", express.static(path.join(__dirname, "public")));
  app.get("/favicon.ico", (req, res) => {
    void req;
    return res.redirect(BRANDING.faviconPath);
  });
  app.use((req, res, next) => {
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("X-Content-Type-Options", "nosniff");
    next();
  });
  app.use(
    session({
      secret: config.sessionSecret,
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        sameSite: "lax",
        secure: config.sessionCookieSecure,
      },
    }),
  );
  app.use(ensureCsrfToken);

  app.use(createHealthRouter({ config, scriptRunner: appServices.scriptRunner }));
  app.use(
    createGithubWebhookRouter({
      config,
      deploymentService: appServices.deploymentService,
      logger: appServices.logger,
    }),
  );

  app.use(express.urlencoded({ extended: false }));
  app.use(express.json());

  app.use(createAuthRouter({ config, clientAssets }));
  app.use(
    createUiRouter({
      clientAssets,
      config,
      deploymentService: appServices.deploymentService,
      repoStore: appServices.repoStore,
      sshKeyManager: appServices.sshKeyManager,
    }),
  );
  app.use(
    createApiRouter({
      deploymentService: appServices.deploymentService,
      repoStore: appServices.repoStore,
      sshKeyManager: appServices.sshKeyManager,
    }),
  );

  app.use((error, req, res, next) => {
    void next;
    const status =
      error instanceof RepoValidationError
        ? 400
        : error instanceof ScriptError
          ? 500
          : Number(error.statusCode || 500);
    const message = error.details?.message || error.message || "Unexpected error.";
    void appServices.logger.error("Unhandled request error", {
      status,
      message,
      path: req.path,
    });

    if (req.path.startsWith("/api/") || req.path === "/webhooks/github") {
      return res.status(status).json({ error: message });
    }

    return res.status(status).send(message);
  });

  return app;
}

export { createApp };
