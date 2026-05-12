class FakeRuntimeInspector {
  async inspectDeployment(deployment) {
    if (deployment.status !== "running") {
      return {
        available: true,
        status: "no-containers",
        containers: [],
        publicServiceContainer: null,
      };
    }

    const container = {
      id: `${deployment.projectName}1234`.slice(0, 12),
      name: `${deployment.projectName}-${deployment.publicService}-1`,
      service: deployment.publicService,
      state: "running",
      networks: ["default", "preview-proxy"],
      labels: {
        "traefik.enable": "true",
        "traefik.docker.network": "preview-proxy",
        [`traefik.http.routers.${deployment.projectName}.entrypoints`]: "web",
        [`traefik.http.routers.${deployment.projectName}.rule`]: `Host(\`${deployment.previewHost}\`)`,
        [`traefik.http.services.${deployment.projectName}.loadbalancer.server.port`]: String(deployment.publicPort),
      },
    };

    return {
      available: true,
      status: "ok",
      containers: [container],
      publicServiceContainer: container,
    };
  }
}

module.exports = {
  FakeRuntimeInspector,
};
