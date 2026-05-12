const { execFile } = require("child_process");

class RuntimeInspector {
  constructor({ logger }) {
    this.logger = logger;
  }

  async inspectDeployment(deployment) {
    if (!deployment?.projectName) {
      return unavailable("missing-project-name");
    }

    try {
      const idsRaw = await runDocker([
        "ps",
        "-aq",
        "--filter",
        `label=com.docker.compose.project=${deployment.projectName}`,
      ]);
      const ids = idsRaw
        .split(/\r?\n/)
        .map((value) => value.trim())
        .filter(Boolean);

      if (!ids.length) {
        return {
          available: true,
          status: "no-containers",
          containers: [],
          publicServiceContainer: null,
        };
      }

      const inspectRaw = await runDocker(["inspect", ...ids]);
      const inspected = JSON.parse(inspectRaw);
      const containers = inspected
        .map((item) => mapContainer(item))
        .sort((left, right) => left.service.localeCompare(right.service) || left.name.localeCompare(right.name));

      return {
        available: true,
        status: "ok",
        containers,
        publicServiceContainer: containers.find((container) => container.service === deployment.publicService) || null,
      };
    } catch (error) {
      await this.logger.warn("Runtime inspection failed", {
        projectName: deployment.projectName,
        error: error.message,
      });
      return unavailable(error.message);
    }
  }
}

function mapContainer(item) {
  const labels = item?.Config?.Labels || {};
  const allNetworks = Object.keys(item?.NetworkSettings?.Networks || {}).sort();
  const traefikLabels = Object.fromEntries(
    Object.entries(labels)
      .filter(([key]) => key.startsWith("traefik."))
      .sort(([left], [right]) => left.localeCompare(right)),
  );

  return {
    id: String(item.Id || "").slice(0, 12),
    name: String(item.Name || "").replace(/^\//, ""),
    service: String(labels["com.docker.compose.service"] || ""),
    state: String(item.State?.Status || ""),
    networks: allNetworks,
    labels: traefikLabels,
  };
}

function unavailable(reason) {
  return {
    available: false,
    status: "unavailable",
    reason,
    containers: [],
    publicServiceContainer: null,
  };
}

function runDocker(args) {
  return new Promise((resolve, reject) => {
    execFile("docker", args, { maxBuffer: 1024 * 1024 * 8 }, (error, stdout, stderr) => {
      if (error) {
        const message = (stderr || stdout || error.message || "docker command failed").trim();
        reject(new Error(message));
        return;
      }
      resolve(stdout);
    });
  });
}

module.exports = {
  RuntimeInspector,
};
