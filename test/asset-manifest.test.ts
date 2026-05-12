import test from "node:test";
import assert from "node:assert/strict";

import { parseClientAssets } from "../src/lib/asset-manifest.js";
import { createTestContext } from "./helpers/test-app.js";

test("parseClientAssets reads the vite entry asset set", () => {
  const assets = parseClientAssets(
    JSON.stringify({
      "src/client/app.ts": {
        file: "assets/app-abc123.js",
        css: ["assets/app-abc123.css"],
        isEntry: true,
      },
    }),
  );

  assert.deepEqual(assets, {
    css: ["/static/assets/app-abc123.css"],
    js: ["/static/assets/app-abc123.js"],
  });
});

test("createApp can use an explicit client asset override for rendered pages", async () => {
  const context = await createTestContext({
    clientAssets: {
      css: ["/static/assets/test.css"],
      js: ["/static/assets/test.js"],
    },
  });
  test.after(() => context.cleanup());

  const response = await context.agent.get("/login");
  assert.equal(response.status, 200);
  assert.match(response.text, /\/static\/assets\/test\.css/);
  assert.match(response.text, /\/static\/assets\/test\.js/);
  assert.match(response.text, /PreviewOrch \| Sign in/);
  assert.match(response.text, /\/static\/brand\/previeworch-favicon\.png/);
  assert.match(response.text, /\/static\/brand\/previeworch\.png/);
});

test("createApp serves the favicon from the default browser path", async () => {
  const context = await createTestContext();
  test.after(() => context.cleanup());

  const response = await context.agent.get("/favicon.ico");
  assert.equal(response.status, 302);
  assert.equal(response.headers.location, "/static/brand/previeworch-favicon.png");
});
