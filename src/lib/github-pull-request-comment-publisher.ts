import type { Logger } from "./logger.js";
import { formatTimestamp } from "./utils.js";

interface RepoInfo {
  owner: string;
  name: string;
  id?: string | number;
}

interface Metadata {
  targetType: string;
  prNumber?: number;
  deploymentId?: string;
  previewHost?: string;
  targetBranch?: string;
}

interface PublishOptions {
  state: string;
  description?: string;
}

interface GithubAppClient {
  listIssueComments(params: {
    owner: string;
    repo: string;
    issueNumber: number;
    token: string;
  }): Promise<any[]>;
  updateIssueComment(params: {
    owner: string;
    repo: string;
    commentId: number;
    token: string;
    body: string;
  }): Promise<void>;
  createIssueComment(params: {
    owner: string;
    repo: string;
    issueNumber: number;
    token: string;
    body: string;
  }): Promise<void>;
}

interface GithubInstallationResolver {
  resolveRepoAccess(repo: RepoInfo): Promise<{ token: string }>;
}

const STICKY_MARKER = "<!-- previeworch:sticky-comment -->";

class GithubPullRequestCommentPublisher {
  private githubAppClient: GithubAppClient;
  private githubInstallationResolver: GithubInstallationResolver;
  private logger: Logger;
  private orchestratorPublicUrl: string;

  constructor({
    githubAppClient,
    githubInstallationResolver,
    logger,
    orchestratorPublicUrl,
  }: {
    githubAppClient: GithubAppClient;
    githubInstallationResolver: GithubInstallationResolver;
    logger: Logger;
    orchestratorPublicUrl: string;
  }) {
    this.githubAppClient = githubAppClient;
    this.githubInstallationResolver = githubInstallationResolver;
    this.logger = logger;
    this.orchestratorPublicUrl = String(orchestratorPublicUrl || "").replace(/\/+$/, "");
  }

  async publish(
    repo: RepoInfo,
    metadata: Metadata,
    { state, description }: PublishOptions,
  ): Promise<void> {
    if (metadata.targetType !== "pr" || !metadata.prNumber) {
      return;
    }

    try {
      const access = await this.githubInstallationResolver.resolveRepoAccess(repo);
      const comments = await this.githubAppClient.listIssueComments({
        owner: repo.owner,
        repo: repo.name,
        issueNumber: metadata.prNumber,
        token: access.token,
      });
      const existing = Array.isArray(comments)
        ? comments.find((comment) => String(comment.body || "").includes(STICKY_MARKER))
        : null;
      const body = this.buildBody(metadata, { state, description });

      if (existing?.id) {
        await this.githubAppClient.updateIssueComment({
          owner: repo.owner,
          repo: repo.name,
          commentId: existing.id,
          token: access.token,
          body,
        });
        return;
      }

      await this.githubAppClient.createIssueComment({
        owner: repo.owner,
        repo: repo.name,
        issueNumber: metadata.prNumber,
        token: access.token,
        body,
      });
    } catch (error: any) {
      await this.logger.warn("GitHub pull request comment publish failed", {
        deploymentId: metadata.deploymentId,
        repoId: repo.id,
        prNumber: metadata.prNumber,
        message: error?.message,
      });
    }
  }

  buildBody(metadata: Metadata, { state, description }: PublishOptions): string {
    const lines = [
      STICKY_MARKER,
      "## PreviewOrch",
      "",
      `State: **${state}**`,
      description ? `Message: ${description}` : "",
      metadata.previewHost ? `Preview: http://${metadata.previewHost}` : "",
      `Target: PR #${metadata.prNumber}`,
      metadata.targetBranch ? `Branch: \`${metadata.targetBranch}\`` : "",
      this.buildDashboardUrl(metadata.deploymentId)
        ? `Dashboard: ${this.buildDashboardUrl(metadata.deploymentId)}`
        : "",
      `Updated: ${formatTimestamp()}`,
    ];

    return lines.filter(Boolean).join("\n");
  }

  buildDashboardUrl(deploymentId?: string): string {
    if (!this.orchestratorPublicUrl) {
      return "";
    }
    try {
      const url = new URL(this.orchestratorPublicUrl);
      url.hash = `deployment-${deploymentId}`;
      return url.toString();
    } catch (err) {
      this.logger?.warn?.("Invalid orchestratorPublicUrl for dashboard URL", {
        orchestratorPublicUrl: this.orchestratorPublicUrl,
        error: err instanceof Error ? err.message : String(err),
      });
      return "";
    }
  }
}

export { GithubPullRequestCommentPublisher, STICKY_MARKER };
