const path = require("path");

function resolveDataPath(envValue, fallback) {
  return path.resolve(envValue || fallback);
}

function getConfig(overrides = {}) {
  const cwd = overrides.cwd || process.cwd();
  const dataRoot = resolveDataPath(overrides.DATA_ROOT || process.env.DATA_ROOT, path.join(cwd, "data"));
  const configDir = resolveDataPath(overrides.CONFIG_DIR || process.env.CONFIG_DIR, path.join(dataRoot, "config"));
  const deploymentsDir = resolveDataPath(
    overrides.DEPLOYMENTS_DIR || process.env.DEPLOYMENTS_DIR,
    path.join(dataRoot, "deployments"),
  );
  const logsDir = resolveDataPath(overrides.LOGS_DIR || process.env.LOGS_DIR, path.join(dataRoot, "logs"));
  const sshDir = resolveDataPath(overrides.SSH_DIR || process.env.SSH_DIR, path.join(dataRoot, "ssh"));
  const scriptsDir = path.join(cwd, "scripts");
  const baseDomain = overrides.BASE_DOMAIN || process.env.BASE_DOMAIN || "preview.example.com";

  return {
    port: Number(overrides.PORT || process.env.PORT || 3000),
    baseDomain,
    orchestratorPublicUrl: normalizeOrchestratorPublicUrl(
      overrides.ORCHESTRATOR_PUBLIC_URL || process.env.ORCHESTRATOR_PUBLIC_URL,
      baseDomain,
    ),
    adminUsername: overrides.ADMIN_USERNAME || process.env.ADMIN_USERNAME || "admin",
    adminPasswordHash: overrides.ADMIN_PASSWORD_BCRYPT_HASH || process.env.ADMIN_PASSWORD_BCRYPT_HASH || "",
    sessionSecret: overrides.SESSION_SECRET || process.env.SESSION_SECRET || "change-me",
    sessionCookieSecure: normalizeSessionCookieSecure(
      overrides.SESSION_COOKIE_SECURE || process.env.SESSION_COOKIE_SECURE,
      overrides.NODE_ENV || process.env.NODE_ENV || "development",
    ),
    githubWebhookSecret: overrides.GITHUB_WEBHOOK_SECRET || process.env.GITHUB_WEBHOOK_SECRET || "",
    githubDeploymentsToken: overrides.GITHUB_DEPLOYMENTS_TOKEN || process.env.GITHUB_DEPLOYMENTS_TOKEN || "",
    githubApiBaseUrl: overrides.GITHUB_API_BASE_URL || process.env.GITHUB_API_BASE_URL || "https://api.github.com",
    traefikNetworkName: overrides.TRAEFIK_NETWORK_NAME || process.env.TRAEFIK_NETWORK_NAME || "preview-proxy",
    nodeEnv: overrides.NODE_ENV || process.env.NODE_ENV || "development",
    dataRoot,
    configDir,
    deploymentsDir,
    logsDir,
    sshDir,
    dockerSocketPath: overrides.DOCKER_SOCKET_PATH || process.env.DOCKER_SOCKET_PATH || "/var/run/docker.sock",
    reposFile: path.join(configDir, "repos.json"),
    settingsFile: path.join(configDir, "settings.json"),
    appLogFile: path.join(logsDir, "app.log"),
    eventsLogFile: path.join(logsDir, "events.jsonl"),
    deploymentLogsDir: path.join(logsDir, "deployments"),
    scripts: {
      validateRepo: path.join(scriptsDir, "validate-repo.sh"),
      deployPr: path.join(scriptsDir, "deploy-pr.sh"),
      destroyPr: path.join(scriptsDir, "destroy-pr.sh"),
    },
  };
}

function normalizeSessionCookieSecure(value, nodeEnv) {
  if (value === undefined || value === null || value === "") {
    return nodeEnv === "production" ? "auto" : false;
  }

  const normalized = String(value).toLowerCase();
  if (normalized === "auto") {
    return "auto";
  }
  if (["true", "1", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["false", "0", "no", "off"].includes(normalized)) {
    return false;
  }

  return nodeEnv === "production" ? "auto" : false;
}

function normalizeOrchestratorPublicUrl(value, baseDomain) {
  const explicit = String(value || "").trim();
  if (explicit) {
    return explicit.replace(/\/+$/, "");
  }

  return `https://orchestrator.${baseDomain}`;
}

module.exports = {
  getConfig,
};
