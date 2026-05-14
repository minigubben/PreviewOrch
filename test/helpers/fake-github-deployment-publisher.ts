// @ts-nocheck
class FakeGithubDeploymentPublisher {
  constructor({
    enabled = true,
    orchestratorPublicUrl = "https://previeworch.preview.example.com",
  } = {}) {
    this.enabledValue = enabled;
    this.orchestratorPublicUrl = orchestratorPublicUrl.replace(/\/+$/, "");
    this.deployments = [];
    this.statuses = [];
    this.nextDeploymentId = 1000;
  }

  isEnabled() {
    return this.enabledValue;
  }

  async createDeployment({ owner, repo, ref, environment, description, payload }) {
    const deployment = {
      id: this.nextDeploymentId++,
      owner,
      repo,
      ref,
      environment,
      description,
      payload,
      statuses_url: `https://api.github.com/repos/${owner}/${repo}/deployments/${this.nextDeploymentId}/statuses`,
    };
    this.deployments.push(deployment);
    return deployment;
  }

  async createDeploymentStatus(input) {
    this.statuses.push({ ...input });
    return {
      id: this.statuses.length,
      ...input,
    };
  }

  buildLogUrl(deploymentId) {
    return `${this.orchestratorPublicUrl}/#deployment-${deploymentId}`;
  }
}

export { FakeGithubDeploymentPublisher };
