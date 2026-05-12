// @ts-nocheck
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { bootstrapFilesystem } from "../src/lib/bootstrap.js";
import { getConfig } from "../src/config.js";

test("bootstrapFilesystem keeps settings.json aligned with environment config", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "orchestrator-bootstrap-"));

  try {
    const initial = getConfig({
      cwd: process.cwd(),
      DATA_ROOT: path.join(root, "data"),
      BASE_DOMAIN: "one.example.com",
      TRAEFIK_NETWORK_NAME: "proxy-one",
    });

    await bootstrapFilesystem(initial);
    const first = JSON.parse(await fs.readFile(initial.settingsFile, "utf8"));

    assert.equal(first.baseDomain, "one.example.com");
    assert.equal(first.orchestratorPublicUrl, "https://orchestrator.one.example.com");
    assert.equal(first.traefikNetworkName, "proxy-one");
    assert.equal(first.sourceOfTruth, "environment");

    const next = getConfig({
      cwd: process.cwd(),
      DATA_ROOT: path.join(root, "data"),
      BASE_DOMAIN: "two.example.com",
      TRAEFIK_NETWORK_NAME: "proxy-two",
    });

    await bootstrapFilesystem(next);
    const second = JSON.parse(await fs.readFile(next.settingsFile, "utf8"));

    assert.equal(second.baseDomain, "two.example.com");
    assert.equal(second.orchestratorPublicUrl, "https://orchestrator.two.example.com");
    assert.equal(second.traefikNetworkName, "proxy-two");
    assert.equal(second.sourceOfTruth, "environment");
    assert.equal(second.createdAt, first.createdAt);
    assert.ok(second.updatedAt);

    const explicit = getConfig({
      cwd: process.cwd(),
      DATA_ROOT: path.join(root, "data"),
      BASE_DOMAIN: "three.example.com",
      ORCHESTRATOR_PUBLIC_URL: "https://internal.example.net/orchestrator",
    });

    assert.equal(explicit.orchestratorPublicUrl, "https://internal.example.net/orchestrator");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
