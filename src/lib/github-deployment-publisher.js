class GithubDeploymentPublisher {
  constructor({ apiBaseUrl, token, logger, orchestratorPublicUrl }) {
    this.apiBaseUrl = String(apiBaseUrl || "https://api.github.com").replace(/\/+$/, "");
    this.token = String(token || "").trim();
    this.logger = logger;
    this.orchestratorPublicUrl = String(orchestratorPublicUrl || "").replace(/\/+$/, "");
  }

  isEnabled() {
    return Boolean(this.token);
  }

  async createDeployment({ owner, repo, ref, environment, description, payload = null }) {
    return this.request(`/repos/${owner}/${repo}/deployments`, {
      method: "POST",
      body: {
        ref,
        task: "deploy",
        auto_merge: false,
        required_contexts: [],
        environment,
        description,
        payload,
      },
    });
  }

  async createDeploymentStatus({
    owner,
    repo,
    deploymentId,
    state,
    environment,
    environmentUrl,
    logUrl,
    description,
    autoInactive,
  }) {
    const body = {
      state,
      environment,
      description,
    };

    if (environmentUrl) {
      body.environment_url = environmentUrl;
    }
    if (logUrl) {
      body.log_url = logUrl;
    }
    if (typeof autoInactive === "boolean") {
      body.auto_inactive = autoInactive;
    }

    return this.request(`/repos/${owner}/${repo}/deployments/${deploymentId}/statuses`, {
      method: "POST",
      body,
    });
  }

  buildLogUrl(deploymentId) {
    if (!this.orchestratorPublicUrl) {
      return "";
    }

    const url = new URL(this.orchestratorPublicUrl);
    url.hash = `deployment-${deploymentId}`;
    return url.toString();
  }

  async request(path, { method, body }) {
    const response = await fetch(`${this.apiBaseUrl}${path}`, {
      method,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2026-03-10",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      const error = new Error(`GitHub API ${method} ${path} failed with ${response.status}: ${errorText}`);
      error.status = response.status;
      throw error;
    }

    return response.json();
  }
}

module.exports = {
  GithubDeploymentPublisher,
};
