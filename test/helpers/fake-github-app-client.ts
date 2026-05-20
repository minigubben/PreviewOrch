// @ts-nocheck
class FakeGithubAppClient {
  constructor({ installations = [], convertedManifest = null } = {}) {
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
        },
      };
    this.tokens = new Map();
    this.comments = new Map();
    this.commentWrites = [];
  }

  buildManifest({ orchestratorPublicUrl, appName }) {
    return {
      name: appName,
      url: orchestratorPublicUrl,
      redirect_url: `${orchestratorPublicUrl}/github-app/manifest/callback`,
      callback_urls: [`${orchestratorPublicUrl}/github-app/oauth/callback`],
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

  async convertManifestCode() {
    return this.convertedManifest;
  }

  async exchangeOAuthCode() {
    return {
      access_token: "ghu_fake_user_token",
    };
  }

  async listUserInstallations() {
    return this.installations;
  }

  async listAppInstallations() {
    return this.installations;
  }

  async getRepoInstallation(_githubApp, owner, repo) {
    const fullName = `${owner}/${repo}`.toLowerCase();
    const installation = this.installations.find((entry) =>
      (entry.repositories || []).some(
        (repository) => String(repository.full_name || repository.fullName || "").toLowerCase() === fullName,
      ),
    );
    if (!installation) {
      const error = new Error(`Repository ${fullName} not installed.`);
      error.status = 404;
      throw error;
    }
    return installation;
  }

  async createInstallationAccessToken(_githubApp, installationId) {
    const token = `install-token-${installationId}`;
    this.tokens.set(token, Number(installationId));
    return {
      token,
      expires_at: "2026-05-20T12:00:00.000Z",
    };
  }

  async listInstallationRepositories(token) {
    const installationId = this.tokens.get(token) || parseInstallationId(token);
    const installation = this.installations.find((entry) => Number(entry.id) === Number(installationId));
    return installation?.repositories || [];
  }

  async listIssueComments({ owner, repo, issueNumber }) {
    return this.comments.get(commentKey(owner, repo, issueNumber)) || [];
  }

  async createIssueComment({ owner, repo, issueNumber, body }) {
    const key = commentKey(owner, repo, issueNumber);
    const comments = this.comments.get(key) || [];
    const comment = {
      id: comments.length + 1,
      body,
    };
    comments.push(comment);
    this.comments.set(key, comments);
    this.commentWrites.push({ action: "create", owner, repo, issueNumber, body });
    return comment;
  }

  async updateIssueComment({ owner, repo, commentId, body }) {
    for (const [key, comments] of this.comments.entries()) {
      const [commentOwner, commentRepo] = key.split("#")[0].split("/");
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

function parseInstallationId(token) {
  const match = String(token || "").match(/install-token-(\d+)/);
  return match ? Number(match[1]) : 0;
}

function commentKey(owner, repo, issueNumber) {
  return `${owner}/${repo}#${issueNumber}`;
}

export { FakeGithubAppClient };
