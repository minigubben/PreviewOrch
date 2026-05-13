#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${CLONE_SSH_URL:-}" ]]; then
  echo "{\"ok\":false,\"message\":\"Missing required environment variable: CLONE_SSH_URL\"}"
  exit 1
fi

if [[ -n "${SSH_DIR:-}" ]]; then
  if [[ -f "${SSH_DIR}/id_ed25519" ]]; then
    export GIT_SSH_COMMAND="ssh -i ${SSH_DIR}/id_ed25519 -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new"
  elif [[ -f "${SSH_DIR}/id_rsa" ]]; then
    export GIT_SSH_COMMAND="ssh -i ${SSH_DIR}/id_rsa -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new"
  fi
fi

branches_text="$(
  git ls-remote --heads "${CLONE_SSH_URL}" \
    | awk '{print $2}' \
    | sed -e 's#^refs/heads/##' -e '/^$/d' \
    | sort -u
)"

prs_text="$(
  git ls-remote "${CLONE_SSH_URL}" "refs/pull/*/merge" \
    | awk '{print $2}' \
    | sed -n 's#^refs/pull/\([0-9]\+\)/merge$#\1#p' \
    | sort -n -u
)"

BRANCHES_TEXT="${branches_text}" PRS_TEXT="${prs_text}" DEFAULT_BRANCH="${DEFAULT_BRANCH:-}" node <<'NODE'
const branchLines = String(process.env.BRANCHES_TEXT || "")
  .split("\n")
  .map((line) => line.trim())
  .filter(Boolean);
const prLines = String(process.env.PRS_TEXT || "")
  .split("\n")
  .map((line) => Number(line.trim()))
  .filter((value) => Number.isInteger(value) && value > 0);
const defaultBranch = String(process.env.DEFAULT_BRANCH || "").trim();

const branchSet = new Set(branchLines);
if (defaultBranch) {
  branchSet.add(defaultBranch);
}

const branches = Array.from(branchSet).slice(0, 300);
const pullRequests = prLines.slice(0, 300).map((number) => ({
  number,
  label: `PR #${number}`,
}));

process.stdout.write(`${JSON.stringify({ ok: true, branches, pullRequests })}\n`);
NODE
