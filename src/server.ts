// @ts-nocheck
import { getConfig } from "./config.js";
import { createApp } from "./app.js";
import { BRANDING } from "./lib/branding.js";

async function main() {
  const config = getConfig();
  const app = await createApp({ config });
  app.listen(config.port, () => {
    console.log(`${BRANDING.name} listening on ${config.port}`);
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
