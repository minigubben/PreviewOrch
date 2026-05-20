import crypto from "node:crypto";

import type {
  GithubAppConfig,
  GithubAppInstallationApiRecord,
  GithubAppManifest,
  GithubAppManifestConversion,
  GithubAppRepositoryApiRecord,
  GithubInstallationAccessTokenResponse,
  GithubIssueComment,
  GithubOAuthTokenResponse,
} from "../types/domain.js";
import type { LoggerLike } from "../types/services.js";

interface RawRequestOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
}

class GithubAppClient {
  apiBaseUrl: string;
  oauthBaseUrl: string;
  logger: LoggerLike;

  constructor({ apiBaseUrl, logger }: { apiBaseUrl: string; logger: LoggerLike }) {
    this.apiBaseUrl = String(apiBaseUrl || "https://api.github.com").replace(/\/+$/, "");
    this.oauthBaseUrl = "https://github.com";
    this.logger = logger;
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

  async convertManifestCode(code: string): Promise<GithubAppManifestConversion> {
    return this.rawRequest<GithubAppManifestConversion>(
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

  async exchangeOAuthCode({
    clientId,
    clientSecret,
    code,
    redirectUri,
  }: {
    clientId: string;
    clientSecret: string;
    code: string;
    redirectUri: string;
  }): Promise<GithubOAuthTokenResponse> {
    return this.rawRequest<GithubOAuthTokenResponse>(
      `${this.oauthBaseUrl}/login/oauth/access_token`,
      {
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
      },
    );
  }

  async listUserInstallations(userAccessToken: string): Promise<GithubAppInstallationApiRecord[]> {
    const response = await this.request<{ installations?: GithubAppInstallationApiRecord[] }>(
      "/user/installations",
      {
        token: userAccessToken,
      },
    );
    return Array.isArray(response.installations) ? response.installations : [];
  }

  async listAppInstallations(githubApp: GithubAppConfig): Promise<GithubAppInstallationApiRecord[]> {
    const jwt = this.createAppJwt(githubApp);
    const response = await this.request<GithubAppInstallationApiRecord[]>("/app/installations", {
      token: jwt,
    });
    return Array.isArray(response) ? response : [];
  }

  async getRepoInstallation(
    githubApp: GithubAppConfig,
    owner: string,
    repo: string,
  ): Promise<GithubAppInstallationApiRecord> {
    const jwt = this.createAppJwt(githubApp);
    return this.request<GithubAppInstallationApiRecord>(`/repos/${owner}/${repo}/installation`, {
      token: jwt,
    });
  }

  async createInstallationAccessToken(
    githubApp: GithubAppConfig,
    installationId: number,
  ): Promise<GithubInstallationAccessTokenResponse> {
    const jwt = this.createAppJwt(githubApp);
    return this.request<GithubInstallationAccessTokenResponse>(
      `/app/installations/${installationId}/access_tokens`,
      {
        method: "POST",
        token: jwt,
        body: {},
      },
    );
  }

  async listInstallationRepositories(
    installationAccessToken: string,
  ): Promise<GithubAppRepositoryApiRecord[]> {
    const response = await this.request<{ repositories?: GithubAppRepositoryApiRecord[] }>(
      "/installation/repositories",
      {
        token: installationAccessToken,
      },
    );
    return Array.isArray(response.repositories) ? response.repositories : [];
  }

  async listIssueComments({
    owner,
    repo,
    issueNumber,
    token,
  }: {
    owner: string;
    repo: string;
    issueNumber: number;
    token: string;
  }): Promise<GithubIssueComment[]> {
    return this.request<GithubIssueComment[]>(
      `/repos/${owner}/${repo}/issues/${issueNumber}/comments`,
      {
        token,
      },
    );
  }

  async createIssueComment({
    owner,
    repo,
    issueNumber,
    token,
    body,
  }: {
    owner: string;
    repo: string;
    issueNumber: number;
    token: string;
    body: string;
  }): Promise<GithubIssueComment> {
    return this.request<GithubIssueComment>(`/repos/${owner}/${repo}/issues/${issueNumber}/comments`, {
      method: "POST",
      token,
      body: { body },
    });
  }

  async updateIssueComment({
    owner,
    repo,
    commentId,
    token,
    body,
  }: {
    owner: string;
    repo: string;
    commentId: number;
    token: string;
    body: string;
  }): Promise<GithubIssueComment> {
    return this.request<GithubIssueComment>(`/repos/${owner}/${repo}/issues/comments/${commentId}`, {
      method: "PATCH",
      token,
      body: { body },
    });
  }

  async request<T>(
    path: string,
    {
      method = "GET",
      token,
      body,
    }: { method?: string; token: string; body?: unknown },
  ): Promise<T> {
    return this.rawRequest<T>(`${this.apiBaseUrl}${path}`, {
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

  async rawRequest<T>(url: string, { method = "GET", headers = {}, body }: RawRequestOptions = {}): Promise<T> {
    const init: RequestInit = {
      method,
      headers,
    };
    if (body !== undefined) {
      init.body = JSON.stringify(body);
    }

    const response = await fetch(url, init);

    if (!response.ok) {
      let errorText = await response.text();
      errorText = errorText.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ");
      errorText = errorText.replace(/(gh[pousr]_[A-Za-z0-9_\-]{20,})/g, "[REDACTED_TOKEN]");
      errorText = errorText.replace(/([A-Za-z0-9_\-]{32,})/g, "[REDACTED_SECRET]");
      if (errorText.length > 200) {
        errorText = `${errorText.slice(0, 200)}...`;
      }
      const error = new Error(`${method} ${url} failed with ${response.status}: ${errorText}`) as Error & {
        status?: number;
      };
      error.status = response.status;
      throw error;
    }

    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      return (await response.json()) as T;
    }
    return (await response.text()) as T;
  }

  createAppJwt(githubApp: GithubAppConfig): string {
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

function base64Url(value: string | Buffer): string {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(String(value));
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export { GithubAppClient };
