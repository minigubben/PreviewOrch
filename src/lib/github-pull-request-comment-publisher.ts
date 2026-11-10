import type { DeploymentMetadata, RepoRecord } from "../types/domain.js";
import type {
  GithubAppClientLike,
  GithubInstallationResolverLike,
  LoggerLike,
} from "../types/services.js";
import { formatTimestamp } from "./utils.js";

const STICKY_MARKER = "<!-- previeworch:sticky-comment -->";

class GithubPullRequestCommentPublisher {
  githubAppClient: GithubAppClientLike;
  githubInstallationResolver: GithubInstallationResolverLike;
  logger: LoggerLike;
  orchestratorPublicUrl: string;

  constructor({
    githubAppClient,
    githubInstallationResolver,
    logger,
    orchestratorPublicUrl,
  }: {
    githubAppClient: GithubAppClientLike;
    githubInstallationResolver: GithubInstallationResolverLike;
    logger: LoggerLike;
    orchestratorPublicUrl: string;
  }) {
    this.githubAppClient = githubAppClient;
    this.githubInstallationResolver = githubInstallationResolver;
    this.logger = logger;
    this.orchestratorPublicUrl = String(orchestratorPublicUrl || "").replace(/\/+$/, "");
  }

  async publish(
    repo: RepoRecord,
    metadata: DeploymentMetadata,
    { state, description }: { state: string; description: string },
  ): Promise<void> {
    if (metadata.targetType !== "pr" || !metadata.prNumber) {
      return;
    }

    try {
      const access = await this.githubInstallationResolver.resolveRepoAccess(repo);
      if (!access.installation) {
        return;
      }
      const comments = await this.githubAppClient.listIssueComments({
        owner: repo.owner,
        repo: repo.name,
        issueNumber: metadata.prNumber,
        token: access.token,
      });
      const existing = comments.find((comment) =>
        String(comment.body || "").includes(STICKY_MARKER),
      );
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
    } catch (error) {
      await this.logger.warn("GitHub pull request comment publish failed", {
        deploymentId: metadata.deploymentId,
        repoId: repo.id,
        prNumber: metadata.prNumber,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  buildBody(
    metadata: DeploymentMetadata,
    { state, description }: { state: string; description: string },
  ): string {
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

    return lines.filter((line): line is string => Boolean(line)).join("\n");
  }

  buildDashboardUrl(deploymentId?: string): string {
    if (!this.orchestratorPublicUrl || !deploymentId) {
      return "";
    }

    try {
      const url = new URL(this.orchestratorPublicUrl);
      url.hash = `deployment-${deploymentId}`;
      return url.toString();
    } catch (error) {
      void this.logger.warn("Invalid orchestratorPublicUrl for dashboard URL", {
        orchestratorPublicUrl: this.orchestratorPublicUrl,
        error: error instanceof Error ? error.message : String(error),
      });
      return "";
    }
  }
}

export { GithubPullRequestCommentPublisher, STICKY_MARKER };
