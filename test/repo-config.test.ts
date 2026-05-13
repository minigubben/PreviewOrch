// @ts-nocheck
import test from "node:test";
import assert from "node:assert/strict";

import {
  deriveGithubFullNameFromCloneUrl,
  deriveGithubRepoIdentityFromCloneUrl,
  hydrateStoredRepo,
  normalizeRepoInput,
  validateRepoShape,
} from "../src/lib/repo-config.js";
import { RepoValidationError } from "../src/lib/repo-validation-error.js";

test("normalizeRepoInput derives owner and name from clone url", () => {
  const repo = normalizeRepoInput({
    cloneSshUrl: "git@github.com:ExtronicElektronik/simcards.git",
    composePath: "deploy/preview-compose.yml",
    publicService: "app",
    publicPort: 3000,
    defaultBranch: "main",
  });

  assert.equal(repo.owner, "ExtronicElektronik");
  assert.equal(repo.name, "simcards");
  assert.equal(repo.workingDirectory, ".");
  assert.equal(repo.extraEnvText, "");
  assert.equal(repo.defaultBranchCustomHost, "");
  assert.equal(repo.defaultBranchExtraEnvText, "");
  assert.equal(repo.prDeploymentAccess, "anyone");
  assert.equal(repo.prDeploymentAllowedLoginsText, "");
});

test("hydrateStoredRepo normalizes stored env and working directory fields", () => {
  const repo = hydrateStoredRepo({
    owner: "wrong-owner",
    name: "wrong-name",
    cloneSshUrl: "git@github.com:acme/widgets.git",
    workingDirectory: "ops\\preview",
    appendProxySettings: "true",
    extraEnv: {
      NODE_ENV: "production",
      NULLISH: null,
    },
    defaultBranchCustomHost: "APP.EXAMPLE.COM",
    defaultBranchExtraEnv: {
      NODE_ENV: "staging",
    },
    prDeploymentAccess: "contributors",
    prDeploymentAllowedLogins: ["Dependabot[bot]", "release-bot"],
  });

  assert.equal(repo.owner, "acme");
  assert.equal(repo.name, "widgets");
  assert.equal(repo.workingDirectory, "ops/preview");
  assert.equal(repo.appendProxySettings, true);
  assert.equal(repo.extraEnvText, "NODE_ENV=production\nNULLISH=");
  assert.equal(repo.defaultBranchCustomHost, "app.example.com");
  assert.equal(repo.defaultBranchExtraEnvText, "NODE_ENV=staging");
  assert.equal(repo.prDeploymentAccess, "contributors");
  assert.equal(repo.prDeploymentAllowedLoginsText, "dependabot[bot]\nrelease-bot");
});

test("validateRepoShape rejects reserved env names and path escapes", () => {
  assert.throws(
    () =>
      validateRepoShape({
        owner: "acme",
        name: "widgets",
        cloneSshUrl: "git@github.com:acme/widgets.git",
        composePath: "deploy/preview-compose.yml",
        workingDirectory: "../outside",
        publicService: "app",
        publicPort: 3000,
        defaultBranch: "main",
        appendProxySettings: false,
        extraEnv: {
          ORCH_PREVIEW_HOST: "bad",
        },
      }),
    RepoValidationError,
  );
});

test("clone url helpers preserve repository identity parsing", () => {
  assert.deepEqual(deriveGithubRepoIdentityFromCloneUrl("git@github.com:acme/widgets.git"), {
    owner: "acme",
    name: "widgets",
  });
  assert.equal(deriveGithubFullNameFromCloneUrl("https://github.com/acme/widgets.git"), "acme/widgets");
});

test("normalizeRepoInput parses PR trigger allowlist and access policy", () => {
  const repo = normalizeRepoInput({
    cloneSshUrl: "git@github.com:acme/widgets.git",
    composePath: "deploy/preview-compose.yml",
    publicService: "app",
    publicPort: 3000,
    defaultBranch: "main",
    prDeploymentAccess: "contributors",
    prDeploymentAllowedLoginsText: "Dependabot[bot]\nrelease-bot\nDependabot[bot]",
  });

  assert.equal(repo.prDeploymentAccess, "contributors");
  assert.deepEqual(repo.prDeploymentAllowedLogins, ["dependabot[bot]", "release-bot"]);
  assert.equal(repo.prDeploymentAllowedLoginsText, "dependabot[bot]\nrelease-bot");
});

test("validateRepoShape rejects invalid default branch custom fqdn", () => {
  assert.throws(
    () =>
      validateRepoShape({
        owner: "acme",
        name: "widgets",
        cloneSshUrl: "git@github.com:acme/widgets.git",
        composePath: "deploy/preview-compose.yml",
        workingDirectory: ".",
        publicService: "app",
        publicPort: 3000,
        defaultBranch: "main",
        appendProxySettings: false,
        extraEnv: {},
        defaultBranchExtraEnv: {},
        defaultBranchCustomHost: "https://app.example.com",
        prDeploymentAccess: "anyone",
        prDeploymentAllowedLogins: [],
      }),
    RepoValidationError,
  );
});

test("validateRepoShape rejects invalid PR trigger allowlist entries", () => {
  assert.throws(
    () =>
      validateRepoShape({
        owner: "acme",
        name: "widgets",
        cloneSshUrl: "git@github.com:acme/widgets.git",
        composePath: "deploy/preview-compose.yml",
        workingDirectory: ".",
        publicService: "app",
        publicPort: 3000,
        defaultBranch: "main",
        appendProxySettings: false,
        extraEnv: {},
        prDeploymentAccess: "members",
        prDeploymentAllowedLogins: ["bad login"],
      }),
    RepoValidationError,
  );
});
