import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";

test("validation and target discovery work without installation credentials", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "public-repo-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const repo = path.join(root, "repo");
  await fs.mkdir(repo);
  const git = (...args: string[]) => execFileSync("git", args, { cwd: repo });
  git("init", "-b", "main");
  await fs.writeFile(path.join(repo, "compose.yml"), "services:\n  web:\n    image: nginx\n");
  git("add", ".");
  git("-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "Fixture");
  const env = {
    ...process.env,
    REPO_FULL_NAME: "public/project",
    GITHUB_REPO_URL: repo,
    GITHUB_INSTALLATION_ID: "",
    GITHUB_INSTALLATION_TOKEN: "",
    DEFAULT_BRANCH: "main",
    WORKING_DIRECTORY: ".",
    COMPOSE_PATH: "compose.yml",
    PUBLIC_SERVICE: "web",
    PUBLIC_PORT: "80",
    APPEND_PROXY_SETTINGS: "true",
  };
  for (const script of ["validate-repo.sh", "list-manual-targets.sh"]) {
    const result = spawnSync("bash", [path.resolve("scripts", script)], { env, encoding: "utf8" });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.ok, true);
    if (script === "list-manual-targets.sh") assert.deepEqual(parsed.branches, ["main"]);
  }
  const denied = spawnSync("bash", [path.resolve("scripts/validate-repo.sh")], {
    env: { ...env, GITHUB_REPO_URL: path.join(root, "missing") },
    encoding: "utf8",
  });
  assert.notEqual(denied.status, 0);
  assert.match(JSON.parse(denied.stdout).message, /git ls-remote failed/);
});
