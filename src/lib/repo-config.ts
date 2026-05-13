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
const PR_DEPLOYMENT_ACCESS_VALUES = new Set(["anyone", "members", "collaborators", "contributors"]);

function normalizeRepoInput(input = {}) {
  const extraEnv = parseExtraEnvText(input.extraEnvText, input.extraEnv);
  const prDeploymentAllowedLogins = parseGithubLoginListText(
    input.prDeploymentAllowedLoginsText,
    input.prDeploymentAllowedLogins,
  );
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
    extraEnv,
    extraEnvText: stringifyExtraEnv(extraEnv),
    prDeploymentAccess: normalizePrDeploymentAccess(input.prDeploymentAccess),
    prDeploymentAllowedLogins,
    prDeploymentAllowedLoginsText: stringifyGithubLoginList(prDeploymentAllowedLogins),
    enabled: normalizeBoolean(input.enabled ?? true),
    slug: input.slug || slugifyRepo(identity?.owner || "", identity?.name || ""),
  };
}

function hydrateStoredRepo(repo = {}) {
  const extraEnv = normalizeExistingExtraEnv(repo.extraEnv);
  const prDeploymentAllowedLogins = normalizeExistingGithubLoginList(repo.prDeploymentAllowedLogins);
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
    extraEnv,
    extraEnvText: stringifyExtraEnv(extraEnv),
    prDeploymentAccess: normalizePrDeploymentAccess(repo.prDeploymentAccess),
    prDeploymentAllowedLogins,
    prDeploymentAllowedLoginsText: stringifyGithubLoginList(prDeploymentAllowedLogins),
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
  validatePrDeploymentAccess(repo.prDeploymentAccess);
  validateGithubLoginList(repo.prDeploymentAllowedLogins, "prDeploymentAllowedLogins");

  if (typeof repo.appendProxySettings !== "boolean") {
    throw new RepoValidationError("appendProxySettings must be a boolean.");
  }

  assertWorkingDirectory(repo.workingDirectory);
}

function normalizePrDeploymentAccess(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return PR_DEPLOYMENT_ACCESS_VALUES.has(normalized) ? normalized : "anyone";
}

function validatePrDeploymentAccess(value) {
  if (!PR_DEPLOYMENT_ACCESS_VALUES.has(String(value || ""))) {
    throw new RepoValidationError("prDeploymentAccess must be one of: anyone, members, collaborators, contributors.");
  }
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

function parseGithubLoginListText(loginsText, existingLogins) {
  if (typeof loginsText !== "string") {
    return normalizeExistingGithubLoginList(existingLogins);
  }

  const entries = [];
  const seen = new Set();
  for (const [index, rawLine] of loginsText.split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const login = normalizeGithubLogin(line);
    assertGithubLogin(login, `prDeploymentAllowedLogins line ${index + 1}`);
    if (!seen.has(login)) {
      seen.add(login);
      entries.push(login);
    }
  }

  return entries;
}

function normalizeExistingGithubLoginList(existingLogins) {
  if (!Array.isArray(existingLogins)) {
    return [];
  }

  const entries = [];
  const seen = new Set();
  for (const rawLogin of existingLogins) {
    const login = normalizeGithubLogin(rawLogin);
    if (!login) {
      continue;
    }
    assertGithubLogin(login, "prDeploymentAllowedLogins");
    if (!seen.has(login)) {
      seen.add(login);
      entries.push(login);
    }
  }

  return entries;
}

function stringifyGithubLoginList(logins) {
  return (logins || []).join("\n");
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

function validateGithubLoginList(logins, label) {
  for (const login of logins || []) {
    assertGithubLogin(login, label);
  }
}

function assertEnvVarName(name, label) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(String(name))) {
    throw new RepoValidationError(`${label} must be a valid environment variable name.`);
  }
}

function normalizeGithubLogin(value) {
  return String(value || "").trim().toLowerCase();
}

function assertGithubLogin(login, label) {
  if (!/^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?(?:\[bot\])?$/.test(String(login))) {
    throw new RepoValidationError(`${label} must contain valid GitHub login names.`);
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
