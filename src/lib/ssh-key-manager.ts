// @ts-nocheck
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { BRANDING } from "./branding.js";

const execFileAsync = promisify(execFile);

class SshKeyManager {
  constructor({ sshDir, logger }) {
    this.sshDir = sshDir;
    this.logger = logger;
  }

  async getStatus() {
    const activeKey = await this.findActiveKey();
    if (!activeKey) {
      return {
        hasKey: false,
        algorithm: null,
        publicKey: "",
        publicKeyPath: null,
      };
    }

    return {
      hasKey: true,
      algorithm: activeKey.algorithm,
      publicKey: await fs.readFile(activeKey.publicKeyPath, "utf8"),
      publicKeyPath: activeKey.publicKeyPath,
    };
  }

  async generateOrRotate() {
    await fs.mkdir(this.sshDir, { recursive: true });

    const privateKeyPath = path.join(this.sshDir, "id_ed25519");
    const publicKeyPath = `${privateKeyPath}.pub`;

    await Promise.all([
      fs.rm(privateKeyPath, { force: true }),
      fs.rm(publicKeyPath, { force: true }),
    ]);

    await execFileAsync("ssh-keygen", [
      "-t",
      "ed25519",
      "-N",
      "",
      "-f",
      privateKeyPath,
      "-C",
      `${BRANDING.subdomain}@${os.hostname()}`,
    ]);

    await Promise.all([fs.chmod(privateKeyPath, 0o600), fs.chmod(publicKeyPath, 0o644)]);

    const status = await this.getStatus();
    await this.logger.info("SSH keypair generated", {
      algorithm: status.algorithm,
      publicKeyPath: status.publicKeyPath,
    });
    return status;
  }

  async findActiveKey() {
    const candidates = [
      {
        algorithm: "ed25519",
        privateKeyPath: path.join(this.sshDir, "id_ed25519"),
        publicKeyPath: path.join(this.sshDir, "id_ed25519.pub"),
      },
      {
        algorithm: "rsa",
        privateKeyPath: path.join(this.sshDir, "id_rsa"),
        publicKeyPath: path.join(this.sshDir, "id_rsa.pub"),
      },
    ];

    for (const candidate of candidates) {
      if ((await exists(candidate.privateKeyPath)) && (await exists(candidate.publicKeyPath))) {
        return candidate;
      }
    }

    return null;
  }
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export { SshKeyManager };
