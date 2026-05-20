// @ts-nocheck
import crypto from "node:crypto";

class GithubAppClient {
  constructor({ apiBaseUrl, logger }) {
    this.apiBaseUrl = String(apiBaseUrl || "https://api.github.com").replace(/\/+$/, "");
    this.oauthBaseUrl = "https://github.com";
    this.logger = logger;
  }

  buildManifest({ orchestratorPublicUrl, appName }) {
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

  async convertManifestCode(code) {
    return this.rawRequest(
      `${this.apiBaseUrl}/app-manifests/${encodeURIComponent(code)}/conversions`,
      {
        method: "POST",
        headers: {
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2026-03-10",
        },
      },
    );
  }

  async exchangeOAuthCode({ clientId, clientSecret, code, redirectUri }) {
    return this.rawRequest(`${this.oauthBaseUrl}/login/oauth/access_token`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: {
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri,
      },
    });
  }

  async listUserInstallations(userAccessToken) {
    const response = await this.request("/user/installations", {
      token: userAccessToken,
    });
    return Array.isArray(response.installations) ? response.installations : [];
  }

  async listAppInstallations(githubApp) {
    const jwt = this.createAppJwt(githubApp);
    const response = await this.request("/app/installations", {
      token: jwt,
    });
    return Array.isArray(response) ? response : [];
  }

  async getRepoInstallation(githubApp, owner, repo) {
    const jwt = this.createAppJwt(githubApp);
    return this.request(`/repos/${owner}/${repo}/installation`, {
      token: jwt,
    });
  }

  async createInstallationAccessToken(githubApp, installationId) {
    const jwt = this.createAppJwt(githubApp);
    return this.request(`/app/installations/${installationId}/access_tokens`, {
      method: "POST",
      token: jwt,
      body: {},
    });
  }

  async listInstallationRepositories(installationAccessToken) {
    const response = await this.request("/installation/repositories", {
      token: installationAccessToken,
    });
    return Array.isArray(response.repositories) ? response.repositories : [];
  }

  async listIssueComments({ owner, repo, issueNumber, token }) {
    return this.request(`/repos/${owner}/${repo}/issues/${issueNumber}/comments`, {
      token,
    });
  }

  async createIssueComment({ owner, repo, issueNumber, token, body }) {
    return this.request(`/repos/${owner}/${repo}/issues/${issueNumber}/comments`, {
      method: "POST",
      token,
      body: { body },
    });
  }

  async updateIssueComment({ owner, repo, commentId, token, body }) {
    return this.request(`/repos/${owner}/${repo}/issues/comments/${commentId}`, {
      method: "PATCH",
      token,
      body: { body },
    });
  }

  async request(path, { method = "GET", token, body } = {}) {
    return this.rawRequest(`${this.apiBaseUrl}${path}`, {
      method,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2026-03-10",
      },
      body,
    });
  }

  async rawRequest(url, { method = "GET", headers = {}, body } = {}) {
    const response = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    if (!response.ok) {
      let errorText = await response.text();
      // Sanitize: remove newlines, collapse whitespace, redact secrets, truncate
      errorText = errorText.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ");
      // Redact common secrets (tokens, keys)
      errorText = errorText.replace(/(gh[pousr]_[A-Za-z0-9_\-]{20,})/g, "[REDACTED_TOKEN]");
      errorText = errorText.replace(/([A-Za-z0-9_\-]{32,})/g, "[REDACTED_SECRET]");
      if (errorText.length > 200) errorText = errorText.slice(0, 200) + "...";
      const error = new Error(`${method} ${url} failed with ${response.status}: ${errorText}`);
      error.status = response.status;
      throw error;
    }

    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      return response.json();
    }
    return response.text();
  }

  createAppJwt(githubApp) {
    const now = Math.floor(Date.now() / 1000);
    const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
    const payload = base64Url(
      JSON.stringify({
        iat: now - 60,
        exp: now + 600,
        iss: githubApp.appId,
      }),
    );
    const encoded = `${header}.${payload}`;
    const signature = crypto.sign("RSA-SHA256", Buffer.from(encoded), githubApp.privateKeyPem);
    return `${encoded}.${base64Url(signature)}`;
  }
}

function base64Url(value) {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(String(value));
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export { GithubAppClient };
