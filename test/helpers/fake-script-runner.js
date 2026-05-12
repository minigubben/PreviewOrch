const fs = require("fs/promises");
const path = require("path");

const { buildDeploymentKey, buildPreviewHost, buildProjectName } = require("../../src/lib/utils");

class FakeScriptRunner {
  constructor({ baseDomain = "preview.example.com", deployDelayMs = 0 } = {}) {
    this.baseDomain = baseDomain;
    this.deployDelayMs = deployDelayMs;
    this.calls = [];
  }

  async run({ scriptPath, env = {} }) {
    const scriptName = path.basename(scriptPath);
    this.calls.push({ scriptName, env: { ...env } });

    if (scriptName === "validate-repo.sh") {
      return this.validateRepo(env);
    }
    if (scriptName === "deploy-pr.sh") {
      return this.deploy(env);
    }
    if (scriptName === "destroy-pr.sh") {
      return this.destroy(env);
    }

    throw new Error(`Unexpected script: ${scriptName}`);
  }

  async checkCommand() {
    return true;
  }

  async validateRepo(env) {
    if (env.COMPOSE_PATH === "missing-compose.yml") {
      const error = new Error("Compose file does not exist.");
      error.parsed = { message: "Compose file does not exist at missing-compose.yml" };
      throw error;
    }

    if (env.WORKING_DIRECTORY === "missing-dir") {
      const error = new Error("Working directory does not exist.");
      error.parsed = { message: "Working directory does not exist at missing-dir" };
      throw error;
    }

    if (env.COMPOSE_PATH === "missing-labels.yml" && env.APPEND_PROXY_SETTINGS !== "true") {
      const error = new Error("Missing Traefik contract.");
      error.parsed = { message: "Missing required Traefik label contract token: ${ORCH_PREVIEW_HOST}" };
      throw error;
    }

    return {
      code: 0,
      stdout: `${JSON.stringify({ ok: true, message: "Repository validation passed." })}\n`,
      stderr: "",
      parsed: { ok: true, message: "Repository validation passed." },
    };
  }

  async deploy(env) {
    if (this.deployDelayMs) {
      await new Promise((resolve) => setTimeout(resolve, this.deployDelayMs));
    }

    const repoSlug = env.REPO_SLUG;
    const targetType = env.TARGET_TYPE;
    const targetValue = targetType === "pr" ? Number(env.TARGET_VALUE) : env.TARGET_VALUE;
    const deploymentKey = env.DEPLOYMENT_KEY || buildDeploymentKey(targetType, targetValue);
    const workDir = path.join(env.DEPLOYMENTS_DIR, repoSlug, deploymentKey);
    const projectDirectoryResolved = path.resolve(workDir, env.WORKING_DIRECTORY || ".");
    const composePathResolved = path.join(projectDirectoryResolved, env.COMPOSE_PATH);
    const envFile = path.join(workDir, ".env.runtime");
    const proxyOverridePath = path.join(workDir, ".orchestrator-proxy.override.yml");
    const previewHost = buildPreviewHost(repoSlug, deploymentKey, env.BASE_DOMAIN || this.baseDomain);
    const projectName = buildProjectName(repoSlug, deploymentKey);
    const extraEnv = JSON.parse(env.EXTRA_ENV_JSON || "{}");
    const envLines = [`ORCH_PREVIEW_HOST=${previewHost}`];

    if (env.PREVIEW_HOST_ENV_VAR_NAME) {
      envLines.push(`${env.PREVIEW_HOST_ENV_VAR_NAME}=${previewHost}`);
    }
    for (const [key, value] of Object.entries(extraEnv)) {
      envLines.push(`${key}=${value}`);
    }

    await fs.mkdir(path.dirname(composePathResolved), { recursive: true });
    await fs.writeFile(composePathResolved, "services: {}\n", "utf8");
    await fs.writeFile(envFile, `${envLines.join("\n")}\n`, "utf8");
    if (env.APPEND_PROXY_SETTINGS === "true") {
      await fs.writeFile(proxyOverridePath, "services: {}\n", "utf8");
    }

    return {
      code: 0,
      stdout: `${JSON.stringify({
        deploymentId: `${env.REPO_ID}-${deploymentKey}`,
        deploymentKey,
        repoId: env.REPO_ID,
        repoSlug,
        targetType,
        targetValue,
        targetBranch: env.TARGET_BRANCH || "",
        targetSha: env.TARGET_SHA || "",
        prNumber: targetType === "pr" ? Number(targetValue) : null,
        prBranch: targetType === "pr" ? env.TARGET_BRANCH || "" : null,
        prSha: targetType === "pr" ? env.TARGET_SHA || "" : null,
        previewHost,
        projectName,
        workDir,
        workingDirectory: env.WORKING_DIRECTORY || ".",
        projectDirectoryResolved,
        composePathResolved,
        sourceCloneSshUrl: env.SOURCE_CLONE_SSH_URL,
        envFile,
        proxyOverridePath: env.APPEND_PROXY_SETTINGS === "true" ? proxyOverridePath : "",
        logFile: env.LOG_FILE || "",
        publicPort: Number(env.PUBLIC_PORT),
        publicService: env.PUBLIC_SERVICE,
        appendProxySettings: env.APPEND_PROXY_SETTINGS === "true",
        previewHostEnvVarName: env.PREVIEW_HOST_ENV_VAR_NAME || "",
        extraEnv,
      })}\n`,
      stderr: "",
      parsed: {
        deploymentId: `${env.REPO_ID}-${deploymentKey}`,
        deploymentKey,
        repoId: env.REPO_ID,
        repoSlug,
        targetType,
        targetValue,
        targetBranch: env.TARGET_BRANCH || "",
        targetSha: env.TARGET_SHA || "",
        prNumber: targetType === "pr" ? Number(targetValue) : null,
        prBranch: targetType === "pr" ? env.TARGET_BRANCH || "" : null,
        prSha: targetType === "pr" ? env.TARGET_SHA || "" : null,
        previewHost,
        projectName,
        workDir,
        workingDirectory: env.WORKING_DIRECTORY || ".",
        projectDirectoryResolved,
        composePathResolved,
        sourceCloneSshUrl: env.SOURCE_CLONE_SSH_URL,
        envFile,
        proxyOverridePath: env.APPEND_PROXY_SETTINGS === "true" ? proxyOverridePath : "",
        logFile: env.LOG_FILE || "",
        publicPort: Number(env.PUBLIC_PORT),
        publicService: env.PUBLIC_SERVICE,
        appendProxySettings: env.APPEND_PROXY_SETTINGS === "true",
        previewHostEnvVarName: env.PREVIEW_HOST_ENV_VAR_NAME || "",
        extraEnv,
      },
    };
  }

  async destroy(env) {
    let deploymentId = env.DEPLOYMENT_ID || "";
    let workDir = null;

    try {
      const raw = await fs.readFile(env.DEPLOYMENT_METADATA_PATH, "utf8");
      const metadata = JSON.parse(raw);
      deploymentId = metadata.deploymentId;
      workDir = metadata.workDir;
    } catch {
      return {
        code: 0,
        stdout: `${JSON.stringify({ ok: true, destroyed: false, reason: "metadata-missing" })}\n`,
        stderr: "",
        parsed: { ok: true, destroyed: false, reason: "metadata-missing" },
      };
    }

    await fs.rm(workDir, { recursive: true, force: true });
    return {
      code: 0,
      stdout: `${JSON.stringify({ ok: true, destroyed: true, deploymentId })}\n`,
      stderr: "",
      parsed: { ok: true, destroyed: true, deploymentId },
    };
  }
}

module.exports = {
  FakeScriptRunner,
};
