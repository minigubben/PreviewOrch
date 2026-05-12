import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import YAML from "yaml";

import {
  buildDeploymentKey,
  buildPreviewHost,
  buildProjectName,
} from "../lib/utils.js";
import type { DeploymentMetadata, TargetType } from "../types/domain.js";

interface CliEnvironment {
  [key: string]: string | undefined;
}

export function getDeploymentPaths(env: CliEnvironment): {
  deploymentId: string;
  deploymentKey: string;
  workDir: string;
  projectDir: string;
  composePathResolved: string;
  metadataPath: string;
  envFile: string;
  proxyOverridePath: string;
  previewHost: string;
  projectName: string;
} {
  const repoSlug = required(env.REPO_SLUG, "REPO_SLUG");
  const targetType = required(env.TARGET_TYPE, "TARGET_TYPE") as TargetType;
  const targetValue = targetType === "pr" ? Number(required(env.TARGET_VALUE, "TARGET_VALUE")) : required(env.TARGET_VALUE, "TARGET_VALUE");
  const deploymentKey = env.DEPLOYMENT_KEY || buildDeploymentKey(targetType, targetValue);
  const workDir = path.join(required(env.DEPLOYMENTS_DIR, "DEPLOYMENTS_DIR"), repoSlug, deploymentKey);
  const projectDir = path.resolve(workDir, env.WORKING_DIRECTORY || ".");
  const composePathResolved = path.resolve(projectDir, required(env.COMPOSE_PATH, "COMPOSE_PATH"));
  const deploymentId = `${required(env.REPO_ID, "REPO_ID")}-${deploymentKey}`;
  const previewHost = buildPreviewHost(repoSlug, deploymentKey, required(env.BASE_DOMAIN, "BASE_DOMAIN"));
  const projectName = buildProjectName(repoSlug, deploymentKey);

  return {
    deploymentId,
    deploymentKey,
    workDir,
    projectDir,
    composePathResolved,
    metadataPath: path.join(workDir, "deployment.json"),
    envFile: path.join(workDir, ".env.runtime"),
    proxyOverridePath: path.join(workDir, ".orchestrator-proxy.override.yml"),
    previewHost,
    projectName,
  };
}

export function resolveDeployField(
  env: CliEnvironment,
  field: keyof ReturnType<typeof getDeploymentPaths>,
): string {
  const paths = getDeploymentPaths(env);
  return String(paths[field] ?? "");
}

export function readMetadataField(metadataPath: string, field: keyof DeploymentMetadata | "ok"): string {
  const metadata = readMetadata(metadataPath);
  if (!metadata) {
    return "";
  }

  const value = metadata[field as keyof DeploymentMetadata];
  return String(value ?? "");
}

export function writeRuntimeEnvFile(env: CliEnvironment, targetPath: string, previewHost: string, projectName: string): void {
  const lines = [
    `ORCH_PROJECT_NAME=${projectName}`,
    `ORCH_PREVIEW_HOST=${previewHost}`,
    `ORCH_PREVIEW_SERVICE_PORT=${required(env.PUBLIC_PORT, "PUBLIC_PORT")}`,
    `ORCH_PR_NUMBER=${env.TARGET_TYPE === "pr" ? env.TARGET_VALUE || "" : ""}`,
    `ORCH_PR_BRANCH=${env.TARGET_BRANCH || ""}`,
    `ORCH_PR_SHA=${env.TARGET_SHA || ""}`,
    `ORCH_REPO_SLUG=${required(env.REPO_SLUG, "REPO_SLUG")}`,
  ];

  const previewHostEnvVarName = String(env.PREVIEW_HOST_ENV_VAR_NAME || "").trim();
  if (previewHostEnvVarName) {
    lines.push(`${previewHostEnvVarName}=${previewHost}`);
  }

  const extraEnv = JSON.parse(env.EXTRA_ENV_JSON || "{}") as Record<string, unknown>;
  for (const [key, value] of Object.entries(extraEnv)) {
    lines.push(`${key}=${String(value ?? "")}`);
  }

  fs.writeFileSync(targetPath, `${lines.join("\n")}\n`, "utf8");
}

export function writeProxyOverride(env: CliEnvironment, targetPath: string, previewHost: string, projectName: string): void {
  const publicService = required(env.PUBLIC_SERVICE, "PUBLIC_SERVICE");
  const publicPort = required(env.PUBLIC_PORT, "PUBLIC_PORT");
  const networkName = required(env.TRAEFIK_NETWORK_NAME, "TRAEFIK_NETWORK_NAME");
  const composeAbsPath = required(env.COMPOSE_ABS_PATH, "COMPOSE_ABS_PATH");
  const serviceNetworks = resolveServiceNetworks(composeAbsPath, publicService);

  const doc = {
    services: {
      [publicService]: {
        networks: [...serviceNetworks, networkName],
        labels: {
          "traefik.enable": "true",
          "traefik.docker.network": networkName,
          [`traefik.http.routers.${projectName}.rule`]: `Host(\`${previewHost}\`)`,
          [`traefik.http.routers.${projectName}.entrypoints`]: "web",
          [`traefik.http.services.${projectName}.loadbalancer.server.port`]: String(publicPort),
        },
      },
    },
    networks: {
      [networkName]: {
        external: true,
        name: networkName,
      },
    },
  };

  fs.writeFileSync(targetPath, YAML.stringify(doc), "utf8");
}

export function buildDeploymentMetadata(env: CliEnvironment, paths: ReturnType<typeof getDeploymentPaths>): DeploymentMetadata {
  const targetType = required(env.TARGET_TYPE, "TARGET_TYPE") as TargetType;
  const targetValue = targetType === "pr" ? Number(required(env.TARGET_VALUE, "TARGET_VALUE")) : required(env.TARGET_VALUE, "TARGET_VALUE");
  const extraEnv = JSON.parse(env.EXTRA_ENV_JSON || "{}") as Record<string, string>;

  return {
    deploymentId: paths.deploymentId,
    deploymentKey: paths.deploymentKey,
    repoId: required(env.REPO_ID, "REPO_ID"),
    repoSlug: required(env.REPO_SLUG, "REPO_SLUG"),
    targetType,
    targetValue,
    targetBranch: env.TARGET_BRANCH || null,
    targetSha: env.TARGET_SHA || null,
    prNumber: targetType === "pr" ? Number(targetValue) : null,
    prBranch: targetType === "pr" ? env.TARGET_BRANCH || null : null,
    prSha: targetType === "pr" ? env.TARGET_SHA || null : null,
    previewHost: paths.previewHost,
    projectName: paths.projectName,
    workDir: paths.workDir,
    workingDirectory: env.WORKING_DIRECTORY || ".",
    projectDirectoryResolved: paths.projectDir,
    composePathResolved: paths.composePathResolved,
    proxyOverridePath: env.APPEND_PROXY_SETTINGS === "true" ? paths.proxyOverridePath : "",
    sourceCloneSshUrl: required(env.SOURCE_CLONE_SSH_URL, "SOURCE_CLONE_SSH_URL"),
    status: "running",
    lastEvent: env.LAST_EVENT || "deploy",
    envFile: paths.envFile,
    logFile: env.LOG_FILE || "",
    publicService: required(env.PUBLIC_SERVICE, "PUBLIC_SERVICE"),
    publicPort: Number(required(env.PUBLIC_PORT, "PUBLIC_PORT")),
    appendProxySettings: env.APPEND_PROXY_SETTINGS === "true",
    previewHostEnvVarName: env.PREVIEW_HOST_ENV_VAR_NAME || "",
    extraEnv,
    githubDeployment: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export function writeDeploymentMetadata(targetPath: string, metadata: DeploymentMetadata): void {
  fs.writeFileSync(targetPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
}

export function validateComposeContract(
  composeAbsPath: string,
  publicService: string,
  appendProxySettings: boolean,
): { ok: true; message: string } {
  const raw = fs.readFileSync(composeAbsPath, "utf8");
  const doc = YAML.parse(raw) as {
    services?: Record<string, { labels?: string[] | Record<string, string> }>;
  } | null;

  if (!doc || typeof doc !== "object" || !doc.services || typeof doc.services !== "object") {
    throw new Error("Compose file must contain a services object.");
  }

  const service = doc.services[publicService];
  if (!service) {
    throw new Error(`Configured public service '${publicService}' was not found in compose file.`);
  }

  if (appendProxySettings) {
    return { ok: true, message: "Repository validation passed." };
  }

  const labels: string[] = [];
  if (Array.isArray(service.labels)) {
    labels.push(...service.labels.map(String));
  } else if (service.labels && typeof service.labels === "object") {
    for (const [key, value] of Object.entries(service.labels)) {
      labels.push(`${key}=${value}`);
    }
  }

  const requirements = [
    { needle: "traefik.enable=true", label: "traefik.enable=true" },
    { needle: "${ORCH_PREVIEW_HOST}", label: "${ORCH_PREVIEW_HOST}" },
    { needle: "${ORCH_PROJECT_NAME}", label: "${ORCH_PROJECT_NAME}" },
    { needle: "${ORCH_PREVIEW_SERVICE_PORT}", label: "${ORCH_PREVIEW_SERVICE_PORT}" },
  ];

  for (const requirement of requirements) {
    if (!labels.some((label) => label.includes(requirement.needle))) {
      throw new Error(`Missing required Traefik label contract token: ${requirement.label}`);
    }
  }

  return { ok: true, message: "Repository validation passed." };
}

function resolveServiceNetworks(composeAbsPath: string, publicService: string): string[] {
  const raw = fs.readFileSync(composeAbsPath, "utf8");
  const doc = YAML.parse(raw) as {
    services?: Record<string, { networks?: string[] | Record<string, unknown> }>;
  } | null;

  if (!doc || typeof doc !== "object" || !doc.services || typeof doc.services !== "object") {
    throw new Error("Compose file must contain a services object.");
  }

  const service = doc.services[publicService];
  if (!service) {
    throw new Error(`Configured public service '${publicService}' was not found in compose file.`);
  }

  const declaredNetworks = service.networks;
  if (!declaredNetworks) {
    return ["default"];
  }

  if (Array.isArray(declaredNetworks)) {
    const names = declaredNetworks.map(String).filter(Boolean);
    return names.length ? names : ["default"];
  }

  if (typeof declaredNetworks === "object") {
    const names = Object.keys(declaredNetworks);
    return names.length ? names : ["default"];
  }

  throw new Error(`Configured public service '${publicService}' has an unsupported networks definition.`);
}

function readMetadata(metadataPath: string): DeploymentMetadata | null {
  if (!fs.existsSync(metadataPath)) {
    return null;
  }

  return JSON.parse(fs.readFileSync(metadataPath, "utf8")) as DeploymentMetadata;
}

function required(value: string | undefined, key: string): string {
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function main(argv: string[]): void {
  const [command, ...rest] = argv;
  const env = process.env;

  if (command === "resolve-deploy-paths") {
    printJson(getDeploymentPaths(env));
    return;
  }

  if (command === "resolve-deploy-field") {
    const [field] = rest;
    process.stdout.write(
      resolveDeployField(
        env,
        required(field, "field") as keyof ReturnType<typeof getDeploymentPaths>,
      ),
    );
    return;
  }

  if (command === "read-metadata-field") {
    const [metadataPath, field] = rest;
    process.stdout.write(readMetadataField(required(metadataPath, "metadataPath"), required(field, "field") as keyof DeploymentMetadata));
    return;
  }

  if (command === "write-runtime-env") {
    const [targetPath, previewHost, projectName] = rest;
    writeRuntimeEnvFile(env, required(targetPath, "targetPath"), required(previewHost, "previewHost"), required(projectName, "projectName"));
    return;
  }

  if (command === "write-proxy-override") {
    const [targetPath, previewHost, projectName] = rest;
    writeProxyOverride(env, required(targetPath, "targetPath"), required(previewHost, "previewHost"), required(projectName, "projectName"));
    return;
  }

  if (command === "write-deployment-metadata") {
    const [targetPath] = rest;
    const paths = getDeploymentPaths(env);
    const metadata = buildDeploymentMetadata(env, paths);
    writeDeploymentMetadata(required(targetPath, "targetPath"), metadata);
    printJson(metadata);
    return;
  }

  if (command === "validate-compose-contract") {
    const [composeAbsPath, publicService, appendProxySettings] = rest;
    printJson(
      validateComposeContract(
        required(composeAbsPath, "composeAbsPath"),
        required(publicService, "publicService"),
        appendProxySettings === "true",
      ),
    );
    return;
  }

  throw new Error(`Unknown command: ${command || "<empty>"}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2));
}
