import { RepoValidationError } from "./repo-validation-error.js";

import type { GithubAppConfig, Installation } from "./github-app-store.js";
import type { Logger } from "./logger.js";

interface RepoLike {
  owner: string;
  name: string;
  id?: string | number;
}

interface RepoAccess {
  githubApp: GithubAppConfig;
  installation: Installation;
  token: string;
  expiresAt: string;
  repoUrl: string;
  repoFullName: string;
}

interface GithubAppStore {
  getGithubApp(): Promise<GithubAppConfig | null>;
}

interface GithubAppClient {
  listAppInstallations(githubApp: GithubAppConfig): Promise<any[]>;
  listUserInstallations(userToken: string): Promise<any[]>;
  createInstallationAccessToken(
    githubApp: GithubAppConfig,
    installationId: number,
  ): Promise<{ token: string; expires_at: string }>;
  listInstallationRepositories(token: string): Promise<any[]>;
}

interface GithubInstallationResolverOptions {
  githubAppStore: GithubAppStore;
  githubAppClient: GithubAppClient;
  logger: Logger;
}

class GithubInstallationResolver {
  githubAppStore: GithubAppStore;
  githubAppClient: GithubAppClient;
  logger: Logger;

  constructor({ githubAppStore, githubAppClient, logger }: GithubInstallationResolverOptions) {
    this.githubAppStore = githubAppStore;
    this.githubAppClient = githubAppClient;
    this.logger = logger;
  }

  async getGithubAppOrThrow(): Promise<GithubAppConfig> {
    const githubApp = await this.githubAppStore.getGithubApp();
    if (
      !githubApp?.appId ||
      !githubApp.privateKeyPem ||
      !githubApp.clientId ||
      !githubApp.clientSecret
    ) {
      throw new RepoValidationError("GitHub App is not configured yet.");
    }
    return githubApp;
  }

  async refreshInstallationsUsingApp(): Promise<GithubAppConfig> {
    const githubApp = await this.getGithubAppOrThrow();
    const installations = await this.githubAppClient.listAppInstallations(githubApp);
    return this.replaceInstallations(githubApp, installations);
  }

  async refreshInstallationsForUserToken(userToken: string): Promise<GithubAppConfig> {
    const githubApp = await this.getGithubAppOrThrow();
    const visibleInstallations = await this.githubAppClient.listUserInstallations(userToken);
    const allowedIds = new Set(visibleInstallations.map((installation) => Number(installation.id)));
    const allInstallations = await this.githubAppClient.listAppInstallations(githubApp);
    const filtered = allInstallations.filter((installation) =>
      allowedIds.has(Number(installation.id)),
    );
    return this.replaceInstallations(githubApp, filtered);
  }

  async resolveRepoAccess(
    repoLike: RepoLike,
    { refresh = true }: { refresh?: boolean } = {},
  ): Promise<RepoAccess> {
    const owner = String(repoLike.owner || "").trim();
    const name = String(repoLike.name || "").trim();
    const fullName = `${owner}/${name}`;
    const githubApp = await this.getGithubAppOrThrow();

    let githubAppState = githubApp;
    let installation = findInstallationForRepo(githubAppState, fullName);

    if (!installation && refresh) {
      githubAppState = await this.refreshInstallationsUsingApp();
      installation = findInstallationForRepo(githubAppState, fullName);
    }

    if (!installation) {
      const matchingAccountInstallation = findInstallationForOwner(githubAppState, owner);
      throw new RepoValidationError(`GitHub App does not currently have access to ${fullName}.`, {
        configureUrl: matchingAccountInstallation?.htmlUrl || buildInstallUrl(githubAppState.slug),
      });
    }

    const accessTokenResponse = await this.githubAppClient.createInstallationAccessToken(
      githubAppState,
      installation.id,
    );

    return {
      githubApp: githubAppState,
      installation,
      token: String(accessTokenResponse.token || "").trim(),
      expiresAt: accessTokenResponse.expires_at || "",
      repoUrl: `https://github.com/${fullName}.git`,
      repoFullName: fullName,
    };
  }

  async replaceInstallations(githubApp, installations) {
    const hydratedInstallations = [];
    for (const installation of installations) {
      const installationId = Number(installation.id);
      if (!Number.isInteger(installationId) || installationId <= 0) {
        continue;
      }

      try {
        const accessToken = await this.githubAppClient.createInstallationAccessToken(
          githubApp,
          installationId,
        );
        const repositories = await this.githubAppClient.listInstallationRepositories(
          String(accessToken.token || ""),
        );
        hydratedInstallations.push({
          id: installationId,
          accountLogin: String(installation.account?.login || "").trim(),
          targetType: String(installation.target_type || "").trim(),
          repositorySelection: String(installation.repository_selection || "").trim(),
          permissions: installation.permissions || {},
          events: installation.events || [],
          htmlUrl: String(installation.html_url || "").trim(),
          repositoriesUrl: String(installation.repositories_url || "").trim(),
          suspendedAt: installation.suspended_at || null,
          createdAt: installation.created_at || "",
          updatedAt: installation.updated_at || "",
          repositories,
        });
      } catch (error) {
        await this.logger.warn("Unable to hydrate GitHub App installation repositories", {
          installationId,
          message: error.message,
        });
      }
    }

    return this.githubAppStore.replaceInstallations(hydratedInstallations);
  }
}

function findInstallationForRepo(githubApp, fullName) {
  const normalized = String(fullName || "").toLowerCase();
  return (
    (githubApp?.installations || []).find((installation) =>
      (installation.repositories || []).some(
        (repository) => String(repository.fullName || "").toLowerCase() === normalized,
      ),
    ) || null
  );
}

function findInstallationForOwner(githubApp, ownerLogin) {
  const normalized = String(ownerLogin || "").toLowerCase();
  return (
    (githubApp?.installations || []).find(
      (installation) => String(installation.accountLogin || "").toLowerCase() === normalized,
    ) || null
  );
}

function buildInstallUrl(slug) {
  if (!slug) {
    return "";
  }
  return `https://github.com/apps/${slug}/installations/new`;
}

export { buildInstallUrl, GithubInstallationResolver };
