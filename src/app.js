const path = require("path");

const express = require("express");
const session = require("express-session");

const { ensureCsrfToken } = require("./lib/auth");
const { bootstrapFilesystem } = require("./lib/bootstrap");
const { buildAppServices } = require("./lib/app-services");
const { RepoValidationError } = require("./lib/repo-validation-error");
const { ScriptError } = require("./lib/script-runner");
const { createApiRouter } = require("./routes/api");
const { createAuthRouter } = require("./routes/auth");
const { createGithubWebhookRouter } = require("./routes/github-webhooks");
const { createHealthRouter } = require("./routes/health");
const { createUiRouter } = require("./routes/ui");

async function createApp({ config, services = {} }) {
  await bootstrapFilesystem(config);
  const assetVersion = String(Date.now());
  const appServices = buildAppServices({ config, services });

  const app = express();
  app.set("view engine", "ejs");
  app.set("views", path.join(__dirname, "views"));
  app.set("trust proxy", 1);

  app.use("/static", express.static(path.join(__dirname, "public")));
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

  app.use(createAuthRouter({ config, assetVersion }));
  app.use(
    createUiRouter({
      assetVersion,
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
      error instanceof RepoValidationError ? 400 : error instanceof ScriptError ? 500 : Number(error.statusCode || 500);
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

module.exports = {
  createApp,
};
