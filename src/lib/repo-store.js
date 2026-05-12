const crypto = require("crypto");

const { readJson, writeJson } = require("./json-file");
const { normalizeBoolean, slugifyRepo } = require("./utils");

class RepoValidationError extends Error {
  constructor(message, details = null) {
    super(message);
    this.name = "RepoValidationError";
    this.details = details;
  }
}

class RepoStore {
  constructor({ reposFile, validateScriptPath, scriptRunner, logger, sshDir }) {
    this.reposFile = reposFile;
    this.validateScriptPath = validateScriptPath;
    this.scriptRunner = scriptRunner;
    this.logger = logger;
    this.sshDir = sshDir;
  }

  async list() {
    const repos = await readJson(this.reposFile, []);
    return repos.sort((left, right) => left.owner.localeCompare(right.owner) || left.name.localeCompare(right.name));
  }

  async getById(id) {
    const repos = await this.list();
    return repos.find((repo) => repo.id === id) || null;
  }

  async findByFullName(fullName) {
    const repos = await this.list();
    return repos.find((repo) => `${repo.owner}/${repo.name}`.toLowerCase() === String(fullName).toLowerCase()) || null;
  }

  async create(input) {
    const repos = await this.list();
    const repo = normalizeRepoInput(input);
    this.assertRepoShape(repo);
    this.assertNoDuplicate(repos, repo);
    await this.validate(repo);

    repo.id = crypto.randomUUID();
    repo.slug = slugifyRepo(repo.owner, repo.name);
    repo.createdAt = new Date().toISOString();
    repo.updatedAt = repo.createdAt;

    repos.push(repo);
    await writeJson(this.reposFile, repos);
    await this.logger.info("Repository added", { repoId: repo.id, repoFullName: `${repo.owner}/${repo.name}` });
    return repo;
  }

  async update(id, input) {
    const repos = await this.list();
    const index = repos.findIndex((repo) => repo.id === id);
    if (index === -1) {
      throw new RepoValidationError("Repository not found.");
    }

    const merged = {
      ...repos[index],
      ...normalizeRepoInput(input),
      id,
      slug: slugifyRepo(input.owner || repos[index].owner, input.name || repos[index].name),
      updatedAt: new Date().toISOString(),
    };

    this.assertRepoShape(merged);
    this.assertNoDuplicate(repos, merged, id);
    await this.validate(merged);

    repos[index] = merged;
    await writeJson(this.reposFile, repos);
    await this.logger.info("Repository updated", { repoId: merged.id, repoFullName: `${merged.owner}/${merged.name}` });
    return merged;
  }

  async remove(id) {
    const repos = await this.list();
    const existing = repos.find((repo) => repo.id === id);
    if (!existing) {
      return false;
    }

    await writeJson(
      this.reposFile,
      repos.filter((repo) => repo.id !== id),
    );
    await this.logger.info("Repository deleted", { repoId: id, repoFullName: `${existing.owner}/${existing.name}` });
    return true;
  }

  assertRepoShape(repo) {
    const requiredFields = ["owner", "name", "cloneSshUrl", "composePath", "publicService", "defaultBranch"];
    for (const field of requiredFields) {
      if (!repo[field]) {
        throw new RepoValidationError(`Missing required field: ${field}`);
      }
    }

    const port = Number(repo.publicPort);
    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
      throw new RepoValidationError("publicPort must be a valid TCP port.");
    }
  }

  assertNoDuplicate(repos, candidate, selfId = null) {
    const duplicate = repos.find(
      (repo) =>
        repo.id !== selfId &&
        repo.owner.toLowerCase() === candidate.owner.toLowerCase() &&
        repo.name.toLowerCase() === candidate.name.toLowerCase(),
    );

    if (duplicate) {
      throw new RepoValidationError("A repository with that owner/name already exists.");
    }
  }

  async validate(repo) {
    try {
      const result = await this.scriptRunner.run({
        scriptPath: this.validateScriptPath,
        env: {
          CLONE_SSH_URL: repo.cloneSshUrl,
          DEFAULT_BRANCH: repo.defaultBranch,
          COMPOSE_PATH: repo.composePath,
          PUBLIC_SERVICE: repo.publicService,
          PUBLIC_PORT: String(repo.publicPort),
          SSH_DIR: this.sshDir,
        },
      });

      if (result.parsed?.ok !== true) {
        throw new RepoValidationError(result.parsed?.message || "Repository validation failed.", result.parsed || null);
      }
    } catch (error) {
      if (error instanceof RepoValidationError) {
        throw error;
      }

      const parsed = error.parsed;
      throw new RepoValidationError(parsed?.message || error.stderr || error.message, parsed || null);
    }
  }
}

function normalizeRepoInput(input) {
  return {
    id: input.id,
    owner: String(input.owner || "").trim(),
    name: String(input.name || "").trim(),
    cloneSshUrl: String(input.cloneSshUrl || "").trim(),
    composePath: String(input.composePath || "").trim(),
    publicService: String(input.publicService || "").trim(),
    publicPort: Number(input.publicPort),
    defaultBranch: String(input.defaultBranch || "").trim(),
    enabled: normalizeBoolean(input.enabled ?? true),
  };
}

module.exports = {
  RepoStore,
  RepoValidationError,
};
