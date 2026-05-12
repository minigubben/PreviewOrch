// @ts-nocheck
import path from "node:path";

import { normalizeBoolean, slugifyRepo } from "./utils.js";
import { RepoValidationError } from "./repo-validation-error.js";

const RESERVED_ENV_NAMES = new Set([
  "ORCH_PROJECT_NAME",
  "ORCH_PREVIEW_HOST",
  "ORCH_PREVIEW_SERVICE_PORT",
  "ORCH_PR_NUMBER",
  "ORCH_PR_BRANCH",
  "ORCH_PR_SHA",
  "ORCH_REPO_SLUG",
]);

function normalizeRepoInput(input = {}) {
  const extraEnv = parseExtraEnvText(input.extraEnvText, input.extraEnv);
  const identity = deriveGithubRepoIdentityFromCloneUrl(input.cloneSshUrl);
  return {
    id: input.id,
    owner: identity?.owner || "",
    name: identity?.name || "",
    cloneSshUrl: String(input.cloneSshUrl || "").trim(),
    composePath: String(input.composePath || "").trim(),
    workingDirectory: normalizeWorkingDirectory(input.workingDirectory),
    publicService: String(input.publicService || "").trim(),
    publicPort: Number(input.publicPort),
    defaultBranch: String(input.defaultBranch || "").trim(),
    appendProxySettings: normalizeBoolean(input.appendProxySettings ?? false),
    previewHostEnvVarName: String(input.previewHostEnvVarName || "").trim(),
    extraEnv,
    extraEnvText: stringifyExtraEnv(extraEnv),
    enabled: normalizeBoolean(input.enabled ?? true),
    slug: input.slug || slugifyRepo(identity?.owner || "", identity?.name || ""),
  };
}

function hydrateStoredRepo(repo = {}) {
  const extraEnv = normalizeExistingExtraEnv(repo.extraEnv);
  const identity = deriveGithubRepoIdentityFromCloneUrl(repo.cloneSshUrl) || {
    owner: String(repo.owner || "").trim(),
    name: String(repo.name || "").trim(),
  };
  return {
    ...repo,
    owner: identity.owner,
    name: identity.name,
    slug: repo.slug || slugifyRepo(identity.owner, identity.name),
    appendProxySettings: normalizeBoolean(repo.appendProxySettings ?? false),
    workingDirectory: normalizeWorkingDirectory(repo.workingDirectory),
    previewHostEnvVarName: String(repo.previewHostEnvVarName || "").trim(),
    extraEnv,
    extraEnvText: stringifyExtraEnv(extraEnv),
  };
}

function validateRepoShape(repo) {
  if (!deriveGithubRepoIdentityFromCloneUrl(repo.cloneSshUrl)) {
    throw new RepoValidationError("cloneSshUrl must be a GitHub repository URL such as git@github.com:owner/repo.git.");
  }

  const requiredFields = ["owner", "name", "cloneSshUrl", "composePath", "publicService", "defaultBranch"];
  for (const field of requiredFields) {
    if (!repo[field]) {
      throw new RepoValidationError(`Missing required field: ${field}`);
    }
  }

  const port = Number(repo.publicPort);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new RepoValidationError("publicPort must be a valid TCP port.");
  }

  validateEnvMap(repo.extraEnv);

  if (repo.previewHostEnvVarName) {
    assertEnvVarName(repo.previewHostEnvVarName, "previewHostEnvVarName");
    if (RESERVED_ENV_NAMES.has(repo.previewHostEnvVarName)) {
      throw new RepoValidationError("previewHostEnvVarName cannot reuse an ORCH_* reserved variable name.");
    }
    if (Object.prototype.hasOwnProperty.call(repo.extraEnv, repo.previewHostEnvVarName)) {
      throw new RepoValidationError("previewHostEnvVarName cannot duplicate a key from extraEnv.");
    }
  }

  if (typeof repo.appendProxySettings !== "boolean") {
    throw new RepoValidationError("appendProxySettings must be a boolean.");
  }

  assertWorkingDirectory(repo.workingDirectory);
}

function deriveGithubRepoIdentityFromCloneUrl(cloneUrl) {
  const value = String(cloneUrl || "").trim();
  if (!value) {
    return null;
  }

  const sshMatch = value.match(/^git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/i);
  if (sshMatch) {
    return {
      owner: sshMatch[1],
      name: sshMatch[2],
    };
  }

  const httpsMatch = value.match(/^https?:\/\/github\.com\/([^/]+)\/(.+?)(?:\.git)?$/i);
  if (httpsMatch) {
    return {
      owner: httpsMatch[1],
      name: httpsMatch[2],
    };
  }

  return null;
}

function deriveGithubFullNameFromCloneUrl(cloneUrl) {
  const identity = deriveGithubRepoIdentityFromCloneUrl(cloneUrl);
  if (!identity) {
    return "";
  }
  return `${identity.owner}/${identity.name}`.toLowerCase();
}

function parseExtraEnvText(extraEnvText, existingExtraEnv) {
  if (typeof extraEnvText !== "string") {
    return normalizeExistingExtraEnv(existingExtraEnv);
  }

  const envMap = {};
  const lines = extraEnvText.split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separator = trimmed.indexOf("=");
    if (separator === -1) {
      throw new RepoValidationError(`Invalid extra env line ${index + 1}. Use KEY=value format.`);
    }

    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1);

    assertEnvVarName(key, `extraEnv line ${index + 1}`);
    if (RESERVED_ENV_NAMES.has(key)) {
      throw new RepoValidationError(`extraEnv line ${index + 1} uses reserved variable name ${key}.`);
    }
    if (value.includes("\n") || value.includes("\r")) {
      throw new RepoValidationError(`extraEnv line ${index + 1} contains a newline in the value.`);
    }

    envMap[key] = value;
  }

  return envMap;
}

function normalizeExistingExtraEnv(existingExtraEnv) {
  if (!existingExtraEnv || typeof existingExtraEnv !== "object" || Array.isArray(existingExtraEnv)) {
    return {};
  }

  const normalized = {};
  for (const [key, value] of Object.entries(existingExtraEnv)) {
    normalized[String(key)] = String(value ?? "");
  }
  return normalized;
}

function stringifyExtraEnv(extraEnv) {
  return Object.entries(extraEnv || {})
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
}

function validateEnvMap(envMap) {
  for (const [key, value] of Object.entries(envMap || {})) {
    assertEnvVarName(key, `extraEnv key ${key}`);
    if (RESERVED_ENV_NAMES.has(key)) {
      throw new RepoValidationError(`extraEnv key ${key} uses a reserved ORCH_* variable name.`);
    }
    if (String(value).includes("\n") || String(value).includes("\r")) {
      throw new RepoValidationError(`extraEnv key ${key} contains a newline in the value.`);
    }
  }
}

function assertEnvVarName(name, label) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(String(name))) {
    throw new RepoValidationError(`${label} must be a valid environment variable name.`);
  }
}

function normalizeWorkingDirectory(value) {
  const raw = String(value ?? ".").trim();
  if (!raw) {
    return ".";
  }

  const normalized = path.posix.normalize(raw.replace(/\\/g, "/"));
  return normalized || ".";
}

function assertWorkingDirectory(workingDirectory) {
  const normalized = normalizeWorkingDirectory(workingDirectory);
  if (path.posix.isAbsolute(normalized) || normalized === ".." || normalized.startsWith("../")) {
    throw new RepoValidationError("workingDirectory must stay inside the repository.");
  }
}

export {
  deriveGithubFullNameFromCloneUrl,
  deriveGithubRepoIdentityFromCloneUrl,
  hydrateStoredRepo,
  normalizeRepoInput,
  validateRepoShape,
};
