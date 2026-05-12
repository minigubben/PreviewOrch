const fs = require("fs/promises");
const path = require("path");

const express = require("express");
const session = require("express-session");

const { ensureCsrfToken, requireAuth, verifyCsrfToken, authenticate } = require("./lib/auth");
const { bootstrapFilesystem } = require("./lib/bootstrap");
const { DeploymentService } = require("./lib/deployment-service");
const { DeploymentStore } = require("./lib/deployment-store");
const { buildWebhookContext, verifyGithubSignature } = require("./lib/github");
const { LockManager } = require("./lib/lock-manager");
const { Logger } = require("./lib/logger");
const { RepoStore, RepoValidationError } = require("./lib/repo-store");
const { RuntimeInspector } = require("./lib/runtime-inspector");
const { ScriptError, ScriptRunner } = require("./lib/script-runner");
const { SshKeyManager } = require("./lib/ssh-key-manager");
const { readLogTail } = require("./lib/log-reader");

async function createApp({ config, services = {} }) {
  await bootstrapFilesystem(config);
  const assetVersion = String(Date.now());

  const logger = services.logger || new Logger({ appLogFile: config.appLogFile, eventsLogFile: config.eventsLogFile });
  const scriptRunner = services.scriptRunner || new ScriptRunner({ logger });
  const repoStore =
    services.repoStore ||
    new RepoStore({
      reposFile: config.reposFile,
      validateScriptPath: config.scripts.validateRepo,
      scriptRunner,
      logger,
      sshDir: config.sshDir,
    });
  const deploymentStore =
    services.deploymentStore ||
    new DeploymentStore({
      deploymentsDir: config.deploymentsDir,
      deploymentLogsDir: config.deploymentLogsDir,
    });
  const deploymentService =
    services.deploymentService ||
    new DeploymentService({
      config,
      logger,
      repoStore,
      deploymentStore,
      scriptRunner,
      lockManager: services.lockManager || new LockManager(),
      runtimeInspector: services.runtimeInspector || new RuntimeInspector({ logger }),
    });
  const sshKeyManager = services.sshKeyManager || new SshKeyManager({ sshDir: config.sshDir, logger });

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

  app.get("/healthz", async (req, res) => {
    const [reposReadable, settingsReadable, dockerReachable] = await Promise.all([
      isReadable(config.reposFile),
      isReadable(config.settingsFile),
      isReadable(config.dockerSocketPath).then((socketReady) =>
        socketReady ? scriptRunner.checkCommand("docker", ["version", "--format", "{{.Server.Version}}"]) : false,
      ),
    ]);

    if (reposReadable && settingsReadable && dockerReachable) {
      return res.json({ ok: true });
    }

    return res.status(503).json({
      ok: false,
      reposReadable,
      settingsReadable,
      dockerReachable,
    });
  });

  app.get("/login", (req, res) => {
    if (req.session.user) {
      return res.redirect("/");
    }
    res.setHeader("Cache-Control", "no-store");
    return res.render("login", { error: null, assetVersion });
  });

  app.post("/login", express.urlencoded({ extended: false }), verifyCsrfToken, async (req, res) => {
    const { username, password } = req.body;
    const success = await authenticate(username, password, config);
    if (!success) {
      return res.status(401).render("login", { error: "Invalid username or password." });
    }

    req.session.user = { username };
    return res.redirect("/");
  });

  app.post("/logout", express.urlencoded({ extended: false }), verifyCsrfToken, requireAuth, (req, res) => {
    req.session.destroy(() => {
      res.redirect("/login");
    });
  });

  app.post("/webhooks/github", express.raw({ type: "application/json" }), async (req, res) => {
    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from("");
    const signature = req.get("x-hub-signature-256") || req.get("x-hub-signature");
    const eventName = req.get("x-github-event");

    if (!verifyGithubSignature(rawBody, signature, config.githubWebhookSecret)) {
      await logger.warn("Rejected webhook due to invalid signature");
      return res.status(401).json({ error: "Invalid signature." });
    }

    let payload;
    try {
      payload = JSON.parse(rawBody.toString("utf8"));
    } catch {
      return res.status(400).json({ error: "Invalid JSON payload." });
    }

    if (eventName === "ping") {
      await logger.info("Accepted GitHub webhook ping", {
        hookId: payload.hook_id || null,
        zen: payload.zen || "",
      });
      return res.json({
        ok: true,
        event: "ping",
        zen: payload.zen || "",
        hookId: payload.hook_id || null,
      });
    }

    if (eventName !== "pull_request") {
      await logger.info("Ignored unsupported GitHub event", { eventName });
      return res.json({ ignored: true });
    }

    const webhookContext = buildWebhookContext(payload);
    await deploymentService.handleWebhook(webhookContext);
    return res.json({ ok: true });
  });

  app.use(express.urlencoded({ extended: false }));
  app.use(express.json());

  app.get("/", requireAuth, async (req, res) => {
    const [repos, deployments, eventsLog, sshKeyStatus] = await Promise.all([
      repoStore.list(),
      deploymentService.listDeployments(),
      readLogTail(config.appLogFile, 60),
      sshKeyManager.getStatus(),
    ]);

    res.setHeader("Cache-Control", "no-store");
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
  });

  app.get("/ui/repo-config", requireAuth, async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    return res.render("partials/repo-config", {
      repos: await repoStore.list(),
    });
  });

  app.get("/ui/deployments", requireAuth, async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    return res.render("partials/deployments-panel", {
      deployments: await deploymentService.listDeployments(),
    });
  });

  app.get("/api/repos", requireAuth, async (req, res) => {
    res.json(await repoStore.list());
  });

  app.post("/api/repos", requireAuth, verifyCsrfToken, async (req, res, next) => {
    try {
      const repo = await repoStore.create(req.body);
      res.status(201).json(repo);
    } catch (error) {
      next(error);
    }
  });

  app.put("/api/repos/:id", requireAuth, verifyCsrfToken, async (req, res, next) => {
    try {
      const repo = await repoStore.update(req.params.id, req.body);
      res.json(repo);
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/repos/:id", requireAuth, verifyCsrfToken, async (req, res, next) => {
    try {
      const activeDeployments = await deploymentService.listDeployments();
      if (activeDeployments.some((deployment) => deployment.repoId === req.params.id)) {
        return res.status(409).json({ error: "Destroy active deployments before deleting the repository." });
      }

      const removed = await repoStore.remove(req.params.id);
      if (!removed) {
        return res.status(404).json({ error: "Repository not found." });
      }
      return res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/deployments", requireAuth, async (req, res) => {
    res.json(await deploymentService.listDeployments());
  });

  app.post("/api/ssh-keypair", requireAuth, verifyCsrfToken, async (req, res, next) => {
    try {
      const status = await sshKeyManager.generateOrRotate();
      res.json(status);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/repos/:id/manual-deploy", requireAuth, verifyCsrfToken, async (req, res, next) => {
    try {
      const deployment = await deploymentService.deployManualTarget({
        repoId: req.params.id,
        manualTargetType: req.body.manualTargetType,
        manualTargetValue: req.body.manualTargetValue,
      });
      res.json(deployment);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/deployments/:id/redeploy", requireAuth, verifyCsrfToken, async (req, res, next) => {
    try {
      const deployment = await deploymentService.redeployById(req.params.id);
      res.json(deployment);
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/deployments/:id", requireAuth, verifyCsrfToken, async (req, res, next) => {
    try {
      const result = await deploymentService.destroyById(req.params.id);
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  app.use((error, req, res, next) => {
    void next;
    const status =
      error instanceof RepoValidationError ? 400 : error instanceof ScriptError ? 500 : Number(error.statusCode || 500);
    const message = error.details?.message || error.message || "Unexpected error.";
    void logger.error("Unhandled request error", {
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

async function isReadable(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  createApp,
};
