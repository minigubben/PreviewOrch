// @ts-nocheck
class FakeSshKeyManager {
  constructor(initialStatus = null) {
    this.status = initialStatus || {
      hasKey: false,
      algorithm: null,
      publicKey: "",
      publicKeyPath: null,
    };
    this.generateCalls = 0;
  }

  async getStatus() {
    return { ...this.status };
  }

  async generateOrRotate() {
    this.generateCalls += 1;
    this.status = {
      hasKey: true,
      algorithm: "ed25519",
      publicKey: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFakeGeneratedKey previeworch@test\n",
      publicKeyPath: "/fake/id_ed25519.pub",
    };
    return { ...this.status };
  }
}

export { FakeSshKeyManager };
