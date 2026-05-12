const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");

const { Logger } = require("../src/lib/logger");
const { SshKeyManager } = require("../src/lib/ssh-key-manager");

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
