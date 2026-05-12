// @ts-nocheck
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { Logger } from "../src/lib/logger.js";
import { SshKeyManager } from "../src/lib/ssh-key-manager.js";

test("ssh key manager generates and reports an ed25519 keypair", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "orchestrator-ssh-"));
  const sshDir = path.join(root, "ssh");
  const logsDir = path.join(root, "logs");

  try {
    const logger = new Logger({
      appLogFile: path.join(logsDir, "app.log"),
      eventsLogFile: path.join(logsDir, "events.jsonl"),
    });
    const manager = new SshKeyManager({ sshDir, logger });

    const before = await manager.getStatus();
    assert.equal(before.hasKey, false);

    const generated = await manager.generateOrRotate();
    assert.equal(generated.hasKey, true);
    assert.equal(generated.algorithm, "ed25519");
    assert.match(generated.publicKey, /^ssh-ed25519 /);

    const privateKeyPath = path.join(sshDir, "id_ed25519");
    const publicKeyPath = `${privateKeyPath}.pub`;
    const [privateKey, publicKey] = await Promise.all([
      fs.readFile(privateKeyPath, "utf8"),
      fs.readFile(publicKeyPath, "utf8"),
    ]);

    assert.match(privateKey, /BEGIN OPENSSH PRIVATE KEY/);
    assert.equal(publicKey, generated.publicKey);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
