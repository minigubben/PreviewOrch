import type {
  AppConfig,
  AppSettings,
  GithubAppConfig,
  GithubAppInstallation,
  GithubAppRepository,
} from "../types/domain.js";
import { readJson, writeJson } from "./json-file.js";
import { formatTimestamp } from "./utils.js";

function buildSettingsSnapshot(config: AppConfig, existing: Partial<AppSettings> = {}): AppSettings {
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

function normalizeGithubApp(value: unknown): GithubAppConfig | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Partial<GithubAppConfig>;
  return {
    appId: Number(candidate.appId) || 0,
    clientId: String(candidate.clientId || "").trim(),
    clientSecret: String(candidate.clientSecret || "").trim(),
    privateKeyPem: String(candidate.privateKeyPem || ""),
    webhookSecret: String(candidate.webhookSecret || ""),
    slug: String(candidate.slug || "").trim(),
    name: String(candidate.name || "").trim(),
    ownerLogin: String(candidate.ownerLogin || "").trim(),
    ownerType: String(candidate.ownerType || "").trim(),
    createdAt: String(candidate.createdAt || formatTimestamp()),
    updatedAt: String(candidate.updatedAt || formatTimestamp()),
    installations: normalizeInstallations(candidate.installations),
  };
}

function normalizeInstallations(installations: unknown): GithubAppInstallation[] {
  if (!Array.isArray(installations)) {
    return [];
  }

  return installations
    .map((installation) => normalizeInstallation(installation))
    .filter((installation): installation is GithubAppInstallation => installation !== null)
    .sort((left, right) => left.accountLogin.localeCompare(right.accountLogin));
}

function normalizeInstallation(value: unknown): GithubAppInstallation | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Partial<GithubAppInstallation>;
  const id = Number(candidate.id);
  if (!Number.isInteger(id) || id <= 0) {
    return null;
  }

  return {
    id,
    accountLogin: String(candidate.accountLogin || "").trim(),
    targetType: String(candidate.targetType || "").trim(),
    repositorySelection: String(candidate.repositorySelection || "").trim(),
    permissions: normalizeObjectMap(candidate.permissions),
    events: Array.isArray(candidate.events) ? candidate.events.map(String) : [],
    htmlUrl: String(candidate.htmlUrl || "").trim(),
    repositoriesUrl: String(candidate.repositoriesUrl || "").trim(),
    suspendedAt: candidate.suspendedAt ? String(candidate.suspendedAt) : null,
    createdAt: String(candidate.createdAt || formatTimestamp()),
    updatedAt: String(candidate.updatedAt || formatTimestamp()),
    repositories: normalizeRepositories(candidate.repositories),
  };
}

function normalizeRepositories(repositories: unknown): GithubAppRepository[] {
  if (!Array.isArray(repositories)) {
    return [];
  }

  return repositories
    .map((repository) => {
      if (!repository || typeof repository !== "object") {
        return null;
      }
      const candidate = repository as {
        id?: unknown;
        owner?: { login?: unknown };
        ownerLogin?: unknown;
        name?: unknown;
        full_name?: unknown;
        fullName?: unknown;
        private?: unknown;
      };
      const id = Number(candidate.id);
      const owner = String(candidate.owner?.login || candidate.ownerLogin || "").trim();
      const name = String(candidate.name || "").trim();
      const fullName =
        String(candidate.full_name || candidate.fullName || "").trim() ||
        (owner && name ? `${owner}/${name}` : "");
      if (!fullName) {
        return null;
      }

      return {
        id: Number.isInteger(id) ? id : null,
        name,
        ownerLogin: owner,
        fullName,
        private: Boolean(candidate.private),
      };
    })
    .filter((repository): repository is GithubAppRepository => repository !== null)
    .sort((left, right) => left.fullName.localeCompare(right.fullName));
}

function normalizeObjectMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, entryValue]) => [String(key), String(entryValue || "")]),
  );
}

class GithubAppStore {
  settingsFile: string;

  constructor({ settingsFile }: { settingsFile: string }) {
    this.settingsFile = settingsFile;
  }

  async readSettings(): Promise<Partial<AppSettings> & { githubApp: GithubAppConfig | null }> {
    const settings = await readJson<Partial<AppSettings>>(this.settingsFile, {});
    return {
      ...settings,
      githubApp: normalizeGithubApp(settings.githubApp),
    };
  }

  async syncEnvironment(config: AppConfig): Promise<void> {
    const existing = await readJson<Partial<AppSettings>>(this.settingsFile, {});
    await writeJson(this.settingsFile, buildSettingsSnapshot(config, existing));
  }

  async getGithubApp(): Promise<GithubAppConfig | null> {
    const settings = await readJson<Partial<AppSettings>>(this.settingsFile, {});
    return normalizeGithubApp(settings.githubApp);
  }

  async saveGithubApp(githubAppInput: Partial<GithubAppConfig>): Promise<GithubAppConfig> {
    const settings = await readJson<Partial<AppSettings>>(this.settingsFile, {});
    const existing = normalizeGithubApp(settings.githubApp);
    const now = formatTimestamp();
    const githubApp = normalizeGithubApp({
      ...existing,
      ...githubAppInput,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    });

    if (!githubApp) {
      throw new Error("Unable to normalize GitHub App settings.");
    }

    const nextSettings: Partial<AppSettings> = {
      ...settings,
      githubApp,
      updatedAt: now,
    };
    await writeJson(this.settingsFile, nextSettings);
    return githubApp;
  }

  async replaceInstallations(
    installations: GithubAppInstallation[],
  ): Promise<GithubAppConfig | null> {
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
