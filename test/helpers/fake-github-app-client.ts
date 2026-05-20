import type {
  GithubAppConfig,
  GithubAppInstallationApiRecord,
  GithubAppManifest,
  GithubAppManifestConversion,
  GithubAppRepositoryApiRecord,
  GithubInstallationAccessTokenResponse,
  GithubIssueComment,
  GithubOAuthTokenResponse,
} from "../../src/types/domain.js";

interface CommentWrite {
  action: "create" | "update";
  owner: string;
  repo: string;
  issueNumber?: number;
  commentId?: number;
  body: string;
}

class FakeGithubAppClient {
  installations: GithubAppInstallationApiRecord[];
  convertedManifest: GithubAppManifestConversion;
  tokens: Map<string, number>;
  comments: Map<string, GithubIssueComment[]>;
  commentWrites: CommentWrite[];

  constructor({
    installations = [],
    convertedManifest = null,
  }: {
    installations?: GithubAppInstallationApiRecord[];
    convertedManifest?: GithubAppManifestConversion | null;
  } = {}) {
    this.installations = installations;
    this.convertedManifest =
      convertedManifest ||
      {
        id: 123,
        client_id: "Iv1.fakeclient",
        client_secret: "fake-client-secret",
        pem: "-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----",
        webhook_secret: "webhook-secret",
        slug: "previeworch",
        name: "PreviewOrch",
        owner: {
          login: "previeworch-owner",
          type: "User",
        },
      };
    this.tokens = new Map();
    this.comments = new Map();
    this.commentWrites = [];
  }

  buildManifest({
    orchestratorPublicUrl,
    appName,
  }: {
    orchestratorPublicUrl: string;
    appName: string;
  }): GithubAppManifest {
    return {
      name: appName,
      url: orchestratorPublicUrl,
      redirect_url: `${orchestratorPublicUrl}/github-app/manifest/callback`,
      callback_urls: [`${orchestratorPublicUrl}/github-app/oauth/callback`],
      description: "PreviewOrch GitHub App for PR previews and sticky pull request comments.",
      public: false,
      default_events: ["pull_request"],
      default_permissions: {
        metadata: "read",
        contents: "read",
        pull_requests: "write",
      },
      hook_attributes: {
        url: `${orchestratorPublicUrl}/webhooks/github`,
        active: true,
      },
      request_oauth_on_install: true,
    };
  }

  async convertManifestCode(): Promise<GithubAppManifestConversion> {
    return this.convertedManifest;
  }

  async exchangeOAuthCode(): Promise<GithubOAuthTokenResponse> {
    return {
      access_token: "ghu_fake_user_token",
    };
  }

  async listUserInstallations(): Promise<GithubAppInstallationApiRecord[]> {
    return this.installations;
  }

  async listAppInstallations(): Promise<GithubAppInstallationApiRecord[]> {
    return this.installations;
  }

  async getRepoInstallation(
    _githubApp: GithubAppConfig,
    owner: string,
    repo: string,
  ): Promise<GithubAppInstallationApiRecord> {
    const fullName = `${owner}/${repo}`.toLowerCase();
    const installation = this.installations.find((entry) =>
      (entry.repositories || []).some(
        (repository) =>
          String(repository.full_name || repository.fullName || "").toLowerCase() === fullName,
      ),
    );
    if (!installation) {
      const error = new Error(`Repository ${fullName} not installed.`) as Error & {
        status?: number;
      };
      error.status = 404;
      throw error;
    }
    return installation;
  }

  async createInstallationAccessToken(
    _githubApp: GithubAppConfig,
    installationId: number,
  ): Promise<GithubInstallationAccessTokenResponse> {
    const token = `install-token-${installationId}`;
    this.tokens.set(token, Number(installationId));
    return {
      token,
      expires_at: "2026-05-20T12:00:00.000Z",
    };
  }

  async listInstallationRepositories(token: string): Promise<GithubAppRepositoryApiRecord[]> {
    const installationId = this.tokens.get(token) || parseInstallationId(token);
    const installation = this.installations.find(
      (entry) => Number(entry.id) === Number(installationId),
    );
    return installation?.repositories || [];
  }

  async listIssueComments({
    owner,
    repo,
    issueNumber,
  }: {
    owner: string;
    repo: string;
    issueNumber: number;
  }): Promise<GithubIssueComment[]> {
    return this.comments.get(commentKey(owner, repo, issueNumber)) || [];
  }

  async createIssueComment({
    owner,
    repo,
    issueNumber,
    body,
  }: {
    owner: string;
    repo: string;
    issueNumber: number;
    body: string;
  }): Promise<GithubIssueComment> {
    const key = commentKey(owner, repo, issueNumber);
    const comments = this.comments.get(key) || [];
    const comment: GithubIssueComment = {
      id: comments.length + 1,
      body,
    };
    comments.push(comment);
    this.comments.set(key, comments);
    this.commentWrites.push({ action: "create", owner, repo, issueNumber, body });
    return comment;
  }

  async updateIssueComment({
    owner,
    repo,
    commentId,
    body,
  }: {
    owner: string;
    repo: string;
    commentId: number;
    body: string;
  }): Promise<GithubIssueComment> {
    for (const [key, comments] of this.comments.entries()) {
      const repoKey = key.split("#")[0] || "";
      const [commentOwner, commentRepo] = repoKey.split("/");
      if (commentOwner !== owner || commentRepo !== repo) {
        continue;
      }
      const comment = comments.find((entry) => Number(entry.id) === Number(commentId));
      if (comment) {
        comment.body = body;
        this.commentWrites.push({ action: "update", owner, repo, commentId, body });
        return comment;
      }
    }
    throw new Error(`Comment ${commentId} not found`);
  }
}

function parseInstallationId(token: string): number {
  const match = String(token || "").match(/install-token-(\d+)/);
  return match ? Number(match[1]) : 0;
}

function commentKey(owner: string, repo: string, issueNumber: number): string {
  return `${owner}/${repo}#${issueNumber}`;
}

export { FakeGithubAppClient };
