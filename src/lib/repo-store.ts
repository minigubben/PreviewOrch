// @ts-nocheck
import crypto from "node:crypto";

import { readJson, writeJson } from "./json-file.js";
import {
  deriveGithubFullNameFromRepository,
  hydrateStoredRepo,
  normalizeRepoInput,
  validateRepoShape,
} from "./repo-config.js";
import { RepoValidationError } from "./repo-validation-error.js";
import { slugifyRepo } from "./utils.js";

class RepoStore {
  constructor({ reposFile, validateScriptPath, scriptRunner, logger, githubInstallationResolver }) {
    this.reposFile = reposFile;
    this.validateScriptPath = validateScriptPath;
    this.scriptRunner = scriptRunner;
    this.logger = logger;
    this.githubInstallationResolver = githubInstallationResolver;
  }

  async list() {
    const repos = (await readJson(this.reposFile, [])).map(hydrateStoredRepo);
    return repos.sort(
      (left, right) => left.owner.localeCompare(right.owner) || left.name.localeCompare(right.name),
    );
  }

  async getById(id) {
    const repos = await this.list();
    return repos.find((repo) => repo.id === id) || null;
  }

  async findByFullName(fullName) {
    const repos = await this.list();
    const normalizedFullName = String(fullName || "").toLowerCase();
    return (
      repos.find((repo) => {
        const configuredFullName = `${repo.owner}/${repo.name}`.toLowerCase();
        const storedFullName = deriveGithubFullNameFromRepository(repo.repository);
        return configuredFullName === normalizedFullName || storedFullName === normalizedFullName;
      }) || null
    );
  }

  async create(input) {
    const repos = await this.list();
    const repo = normalizeRepoInput(input);
    validateRepoShape(repo);
    this.assertNoDuplicate(repos, repo);
    const access = await this.validate(repo);

    repo.id = crypto.randomUUID();
    repo.slug = slugifyRepo(repo.owner, repo.name);
    repo.githubInstallationId = access.installation.id;
    repo.createdAt = new Date().toISOString();
    repo.updatedAt = repo.createdAt;

    repos.push(repo);
    await writeJson(this.reposFile, repos);
    await this.logger.info("Repository added", {
      repoId: repo.id,
      repoFullName: `${repo.owner}/${repo.name}`,
    });
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

    validateRepoShape(merged);
    this.assertNoDuplicate(repos, merged, id);
    const access = await this.validate(merged);
    merged.githubInstallationId = access.installation.id;

    repos[index] = merged;
    await writeJson(this.reposFile, repos);
    await this.logger.info("Repository updated", {
      repoId: merged.id,
      repoFullName: `${merged.owner}/${merged.name}`,
    });
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
    await this.logger.info("Repository deleted", {
      repoId: id,
      repoFullName: `${existing.owner}/${existing.name}`,
    });
    return true;
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

  async updateInstallationId(id, githubInstallationId) {
    const repos = await this.list();
    const index = repos.findIndex((repo) => repo.id === id);
    if (index === -1) {
      return null;
    }

    repos[index] = {
      ...repos[index],
      githubInstallationId: Number(githubInstallationId) || null,
      updatedAt: new Date().toISOString(),
    };
    await writeJson(this.reposFile, repos);
    return repos[index];
  }

  async validate(repo) {
    const access = await this.githubInstallationResolver.resolveRepoAccess(repo);
    try {
      const result = await this.scriptRunner.run({
        scriptPath: this.validateScriptPath,
        env: {
          REPO_FULL_NAME: access.repoFullName,
          GITHUB_REPO_URL: access.repoUrl,
          GITHUB_INSTALLATION_ID: String(access.installation.id),
          GITHUB_INSTALLATION_TOKEN: access.token,
          DEFAULT_BRANCH: repo.defaultBranch,
          WORKING_DIRECTORY: repo.workingDirectory,
          COMPOSE_PATH: repo.composePath,
          PUBLIC_SERVICE: repo.publicService,
          PUBLIC_PORT: String(repo.publicPort),
          APPEND_PROXY_SETTINGS: String(repo.appendProxySettings),
          EXTRA_ENV_JSON: JSON.stringify(repo.extraEnv || {}),
        },
      });

      if (result.parsed?.ok !== true) {
        throw new RepoValidationError(
          result.parsed?.message || "Repository validation failed.",
          result.parsed || null,
        );
      }
      return access;
    } catch (error) {
      if (error instanceof RepoValidationError) {
        throw error;
      }

      const parsed = error.parsed;
      throw new RepoValidationError(
        parsed?.message || error.stderr || error.message,
        parsed || null,
      );
    }
  }
}

export { RepoStore };
