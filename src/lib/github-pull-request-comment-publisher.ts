// @ts-nocheck
import { formatTimestamp } from "./utils.js";

const STICKY_MARKER = "<!-- previeworch:sticky-comment -->";

class GithubPullRequestCommentPublisher {
  constructor({ githubAppClient, githubInstallationResolver, logger, orchestratorPublicUrl }) {
    this.githubAppClient = githubAppClient;
    this.githubInstallationResolver = githubInstallationResolver;
    this.logger = logger;
    this.orchestratorPublicUrl = String(orchestratorPublicUrl || "").replace(/\/+$/, "");
  }

  async publish(repo, metadata, { state, description }) {
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
    } catch (error) {
      await this.logger.warn("GitHub pull request comment publish failed", {
        deploymentId: metadata.deploymentId,
        repoId: repo.id,
        prNumber: metadata.prNumber,
        message: error.message,
      });
    }
  }

  buildBody(metadata, { state, description }) {
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

  buildDashboardUrl(deploymentId) {
    if (!this.orchestratorPublicUrl) {
      return "";
    }

    const url = new URL(this.orchestratorPublicUrl);
    url.hash = `deployment-${deploymentId}`;
    return url.toString();
  }
}

export { GithubPullRequestCommentPublisher, STICKY_MARKER };
