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
  });

  assert.equal(repo.owner, "acme");
  assert.equal(repo.name, "widgets");
  assert.equal(repo.workingDirectory, "ops/preview");
  assert.equal(repo.appendProxySettings, true);
  assert.equal(repo.extraEnvText, "NODE_ENV=production\nNULLISH=");
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
        previewHostEnvVarName: "",
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
