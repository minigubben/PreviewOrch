// @ts-nocheck
import { getConfig } from "./config.js";
import { createApp } from "./app.js";

async function main() {
  const config = getConfig();
  const app = await createApp({ config });
  app.listen(config.port, () => {
    console.log(`pr-preview-orchestrator listening on ${config.port}`);
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
