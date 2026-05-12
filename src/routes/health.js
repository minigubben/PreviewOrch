const express = require("express");
const fs = require("fs/promises");

const { asyncHandler } = require("../lib/http");

function createHealthRouter({ config, scriptRunner }) {
  const router = express.Router();

  router.get(
    "/healthz",
    asyncHandler(async (req, res) => {
      const [reposReadable, settingsReadable, dockerReachable] = await Promise.all([
        isReadable(config.reposFile),
        isReadable(config.settingsFile),
        isReadable(config.dockerSocketPath).then((socketReady) =>
          socketReady ? scriptRunner.checkCommand("docker", ["version", "--format", "{{.Server.Version}}"]) : false,
        ),
      ]);

      if (reposReadable && settingsReadable && dockerReachable) {
        return res.json({ ok: true });
      }

      return res.status(503).json({
        ok: false,
        reposReadable,
        settingsReadable,
        dockerReachable,
      });
    }),
  );

  return router;
}

async function isReadable(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  createHealthRouter,
};
