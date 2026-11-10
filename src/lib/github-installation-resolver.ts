import type {
  GithubAppConfig,
  GithubAppInstallation,
  GithubAppInstallationApiRecord,
} from "../types/domain.js";
import type {
  GithubAppClientLike,
  GithubAppStoreLike,
  GithubInstallationResolverLike,
  LoggerLike,
} from "../types/services.js";
import { RepoValidationError } from "./repo-validation-error.js";

interface RepoLike {
  owner: string;
  name: string;
  id?: string | number;
}

class GithubInstallationResolver implements GithubInstallationResolverLike {
  githubAppStore: GithubAppStoreLike;
  githubAppClient: GithubAppClientLike;
  logger: LoggerLike;

  constructor({
    githubAppStore,
    githubAppClient,
    logger,
  }: {
    githubAppStore: GithubAppStoreLike;
    githubAppClient: GithubAppClientLike;
    logger: LoggerLike;
  }) {
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
  ): Promise<{
    githubApp: GithubAppConfig | null;
    installation: GithubAppInstallation | null;
    token: string;
    expiresAt: string;
    repoUrl: string;
    repoFullName: string;
  }> {
    const owner = String(repoLike.owner || "").trim();
    const name = String(repoLike.name || "").trim();
    const fullName = `${owner}/${name}`;
    const githubApp = await this.githubAppStore.getGithubApp();

    let githubAppState = githubApp;
    let installation = githubAppState ? findInstallationForRepo(githubAppState, fullName) : null;

    if (!installation && refresh && githubAppState) {
      githubAppState = await this.refreshInstallationsUsingApp();
      installation = findInstallationForRepo(githubAppState, fullName);
    }

    // The scripts verify anonymous access with git before saving or deploying.
    // No installation credentials are sent for repositories outside the app.
    if (!installation || !githubAppState) {
      return {
        githubApp: githubAppState,
        installation: null,
        token: "",
        expiresAt: "",
        repoUrl: `https://github.com/${fullName}.git`,
        repoFullName: fullName,
      };
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

  async replaceInstallations(
    githubApp: GithubAppConfig,
    installations: GithubAppInstallationApiRecord[],
  ): Promise<GithubAppConfig> {
    const hydratedInstallations: GithubAppInstallation[] = [];
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
          repositories: repositories.map((repository) => ({
            id: Number.isInteger(repository.id) ? Number(repository.id) : null,
            name: String(repository.name || "").trim(),
            ownerLogin: String(repository.owner?.login || "").trim(),
            fullName: String(repository.full_name || "").trim(),
            private: Boolean(repository.private),
          })),
        });
      } catch (error) {
        await this.logger.warn("Unable to hydrate GitHub App installation repositories", {
          installationId,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const nextGithubApp = await this.githubAppStore.replaceInstallations(hydratedInstallations);
    if (!nextGithubApp) {
      throw new RepoValidationError("GitHub App is not configured yet.");
    }
    return nextGithubApp;
  }
}

function findInstallationForRepo(
  githubApp: GithubAppConfig,
  fullName: string,
): GithubAppInstallation | null {
  const normalized = String(fullName || "").toLowerCase();
  return (
    githubApp.installations.find((installation) =>
      installation.repositories.some(
        (repository) => String(repository.fullName || "").toLowerCase() === normalized,
      ),
    ) || null
  );
}

function buildInstallUrl(slug: string, state?: string): string {
  if (!slug) {
    return "";
  }

  const baseUrl = `https://github.com/apps/${slug}/installations/new`;
  const normalizedState = String(state || "").trim();
  if (!normalizedState) {
    return baseUrl;
  }

  return `${baseUrl}?state=${encodeURIComponent(normalizedState)}`;
}

export { buildInstallUrl, GithubInstallationResolver };
