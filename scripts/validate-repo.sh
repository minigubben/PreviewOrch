#!/usr/bin/env bash
set -euo pipefail

SCRIPT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT_HELPER_PATH="${SCRIPT_ROOT}/dist/src/cli/script-helper.js"

# These scripts return JSON because the Node script runner forwards stdout
# directly to the app.
required_vars=(
  CLONE_SSH_URL
  DEFAULT_BRANCH
  WORKING_DIRECTORY
  COMPOSE_PATH
  PUBLIC_SERVICE
  PUBLIC_PORT
)

for var_name in "${required_vars[@]}"; do
  if [[ -z "${!var_name:-}" ]]; then
    echo "{\"ok\":false,\"message\":\"Missing required environment variable: ${var_name}\"}"
    exit 1
  fi
done

# Prefer a repo-specific SSH key when the app has mounted one for validation.
if [[ -n "${SSH_DIR:-}" ]]; then
  if [[ -f "${SSH_DIR}/id_ed25519" ]]; then
    export GIT_SSH_COMMAND="ssh -i ${SSH_DIR}/id_ed25519 -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new"
  elif [[ -f "${SSH_DIR}/id_rsa" ]]; then
    export GIT_SSH_COMMAND="ssh -i ${SSH_DIR}/id_rsa -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new"
  fi
fi

# Clone into a disposable checkout so validation never mutates deployment state.
tmp_dir="$(mktemp -d)"
cleanup() {
  rm -rf "${tmp_dir}"
}
trap cleanup EXIT

if ! git ls-remote "${CLONE_SSH_URL}" >/dev/null 2>&1; then
  echo "{\"ok\":false,\"message\":\"git ls-remote failed for ${CLONE_SSH_URL}\"}"
  exit 1
fi

if ! git clone --depth 1 --branch "${DEFAULT_BRANCH}" "${CLONE_SSH_URL}" "${tmp_dir}/repo" >/dev/null 2>&1; then
  echo "{\"ok\":false,\"message\":\"Unable to clone ${DEFAULT_BRANCH} from ${CLONE_SSH_URL}\"}"
  exit 1
fi

project_dir="${tmp_dir}/repo/${WORKING_DIRECTORY}"
if [[ ! -d "${project_dir}" ]]; then
  echo "{\"ok\":false,\"message\":\"Working directory does not exist at ${WORKING_DIRECTORY}\"}"
  exit 1
fi

compose_file="${project_dir}/${COMPOSE_PATH}"
if [[ ! -f "${compose_file}" ]]; then
  echo "{\"ok\":false,\"message\":\"Compose file does not exist at ${COMPOSE_PATH}\"}"
  exit 1
fi

# Let the TypeScript helper parse Compose YAML and enforce the preview contract.
node "${SCRIPT_HELPER_PATH}" validate-compose-contract "${compose_file}" "${PUBLIC_SERVICE}" "${APPEND_PROXY_SETTINGS:-false}"
