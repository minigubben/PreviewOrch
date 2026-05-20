// @ts-nocheck
import { readJson, writeJson } from "./json-file.js";
import { formatTimestamp } from "./utils.js";

function buildSettingsSnapshot(config, existing = {}) {
  return {
    createdAt: existing.createdAt || formatTimestamp(),
    updatedAt: formatTimestamp(),
    baseDomain: config.baseDomain,
    orchestratorPublicUrl: config.orchestratorPublicUrl,
    traefikNetworkName: config.traefikNetworkName,
    sourceOfTruth: "environment",
    githubApp: normalizeGithubApp(existing.githubApp),
  };
}

function normalizeGithubApp(value) {
  if (!value || typeof value !== "object") {
    return null;
  }

  return {
    appId: Number(value.appId) || 0,
    clientId: String(value.clientId || "").trim(),
    clientSecret: String(value.clientSecret || "").trim(),
    privateKeyPem: String(value.privateKeyPem || ""),
    webhookSecret: String(value.webhookSecret || ""),
    slug: String(value.slug || "").trim(),
    name: String(value.name || "").trim(),
    ownerLogin: String(value.ownerLogin || "").trim(),
    ownerType: String(value.ownerType || "").trim(),
    createdAt: String(value.createdAt || formatTimestamp()),
    updatedAt: String(value.updatedAt || formatTimestamp()),
    installations: normalizeInstallations(value.installations),
  };
}

function normalizeInstallations(installations) {
  if (!Array.isArray(installations)) {
    return [];
  }

  return installations
    .map((installation) => normalizeInstallation(installation))
    .filter(Boolean)
    .sort((left, right) => left.accountLogin.localeCompare(right.accountLogin));
}

function normalizeInstallation(value) {
  if (!value || typeof value !== "object") {
    return null;
  }

  const id = Number(value.id);
  if (!Number.isInteger(id) || id <= 0) {
    return null;
  }

  return {
    id,
    accountLogin: String(value.accountLogin || "").trim(),
    targetType: String(value.targetType || "").trim(),
    repositorySelection: String(value.repositorySelection || "").trim(),
    permissions: normalizeObjectMap(value.permissions),
    events: Array.isArray(value.events) ? value.events.map(String) : [],
    htmlUrl: String(value.htmlUrl || "").trim(),
    repositoriesUrl: String(value.repositoriesUrl || "").trim(),
    suspendedAt: value.suspendedAt ? String(value.suspendedAt) : null,
    createdAt: String(value.createdAt || formatTimestamp()),
    updatedAt: String(value.updatedAt || formatTimestamp()),
    repositories: normalizeRepositories(value.repositories),
  };
}

function normalizeRepositories(repositories: any): Repository[] {
  if (!Array.isArray(repositories)) {
    return [];
  }
  return repositories
    .map((repository) => {
      const id = Number(repository?.id);
      const owner = String(repository?.owner?.login || repository?.ownerLogin || "").trim();
      const name = String(repository?.name || "").trim();
      const fullName =
        String(repository?.full_name || repository?.fullName || "").trim() ||
        (owner && name ? `${owner}/${name}` : "");
      if (!fullName) {
        return null;
      }
      return {
        id: Number.isInteger(id) ? id : null,
        name,
        ownerLogin: owner,
        fullName,
        private: Boolean(repository?.private),
      };
    })
    .filter(Boolean) as Repository[]
    .sort((left, right) => left.fullName.localeCompare(right.fullName));
}

function normalizeObjectMap(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, entryValue]) => [String(key), String(entryValue || "")]),
  );
}

class GithubAppStore {
  constructor({ settingsFile }) {
    this.settingsFile = settingsFile;
  }

  async readSettings() {
    const settings = await readJson(this.settingsFile, {});
    return {
      ...settings,
      githubApp: normalizeGithubApp(settings.githubApp),
    };
  }

  async syncEnvironment(config) {
    const existing = await readJson(this.settingsFile, {});
    await writeJson(this.settingsFile, buildSettingsSnapshot(config, existing));
  }

  async getGithubApp() {
    const settings = await readJson(this.settingsFile, {});
    return normalizeGithubApp(settings.githubApp);
  }

  async saveGithubApp(githubAppInput) {
    const settings = await readJson(this.settingsFile, {});
    const existing = normalizeGithubApp(settings.githubApp);
    const now = formatTimestamp();
    const githubApp = normalizeGithubApp({
      ...existing,
      ...githubAppInput,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    });

    settings.githubApp = githubApp;
    settings.updatedAt = now;
    await writeJson(this.settingsFile, settings);
    return githubApp;
  }

  async replaceInstallations(installations) {
    const githubApp = await this.getGithubApp();
    if (!githubApp) {
      return null;
    }

    return this.saveGithubApp({
      ...githubApp,
      installations: normalizeInstallations(installations),
    });
  }
}

export { GithubAppStore, buildSettingsSnapshot, normalizeGithubApp, normalizeInstallations };
