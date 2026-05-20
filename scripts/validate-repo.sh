#!/usr/bin/env bash
set -euo pipefail

SCRIPT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT_HELPER_PATH="${SCRIPT_ROOT}/dist/src/cli/script-helper.js"

# These scripts return JSON because the Node script runner forwards stdout
# directly to the app.
required_vars=(
  REPO_FULL_NAME
  GITHUB_REPO_URL
  GITHUB_INSTALLATION_ID
  GITHUB_INSTALLATION_TOKEN
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

# Clone into a disposable checkout so validation never mutates deployment state.
tmp_dir="$(mktemp -d)"
askpass_path="${tmp_dir}/git-askpass.sh"
cleanup() {
  rm -rf "${tmp_dir}"
}
trap cleanup EXIT

cat >"${askpass_path}" <<'EOF'
#!/usr/bin/env bash
case "${1:-}" in
  *Username*) printf '%s\n' "x-access-token" ;;
  *Password*) printf '%s\n' "${GITHUB_INSTALLATION_TOKEN}" ;;
  *) printf '\n' ;;
esac
EOF
chmod 700 "${askpass_path}"

export GIT_TERMINAL_PROMPT=0
export GIT_ASKPASS="${askpass_path}"

if ! git ls-remote "${GITHUB_REPO_URL}" >/dev/null 2>&1; then
  echo "{\"ok\":false,\"message\":\"git ls-remote failed for ${REPO_FULL_NAME}\"}"
  exit 1
fi

if ! git clone --depth 1 --branch "${DEFAULT_BRANCH}" "${GITHUB_REPO_URL}" "${tmp_dir}/repo" >/dev/null 2>&1; then
  echo "{\"ok\":false,\"message\":\"Unable to clone ${DEFAULT_BRANCH} from ${REPO_FULL_NAME}\"}"
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
