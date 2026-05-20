#!/usr/bin/env bash
set -euo pipefail

SCRIPT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT_HELPER_PATH="${SCRIPT_ROOT}/dist/src/cli/script-helper.js"

required_vars=(
  REPO_ID
  REPO_OWNER
  REPO_NAME
  REPO_SLUG
  REPO_FULL_NAME
  GITHUB_REPO_URL
  GITHUB_INSTALLATION_ID
  GITHUB_INSTALLATION_TOKEN
  COMPOSE_PATH
  WORKING_DIRECTORY
  PUBLIC_SERVICE
  PUBLIC_PORT
  DEPLOYMENT_KEY
  TARGET_TYPE
  TARGET_VALUE
  BASE_DOMAIN
  DEPLOYMENTS_DIR
)

for var_name in "${required_vars[@]}"; do
  if [[ -z "${!var_name:-}" ]]; then
    echo "{\"ok\":false,\"message\":\"Missing required environment variable: ${var_name}\"}"
    exit 1
  fi
done

askpass_root="$(mktemp -d)"
askpass_path="${askpass_root}/git-askpass.sh"

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

# Resolve names and paths through the helper so shell and TypeScript agree on
# deployment IDs, hostnames, and filesystem layout.
project_name="$(node "${SCRIPT_HELPER_PATH}" resolve-deploy-field projectName)"
preview_host="$(node "${SCRIPT_HELPER_PATH}" resolve-deploy-field previewHost)"
work_dir="$(node "${SCRIPT_HELPER_PATH}" resolve-deploy-field workDir)"
project_dir="$(node "${SCRIPT_HELPER_PATH}" resolve-deploy-field projectDir)"
compose_path_resolved="$(node "${SCRIPT_HELPER_PATH}" resolve-deploy-field composePathResolved)"
metadata_path="$(node "${SCRIPT_HELPER_PATH}" resolve-deploy-field metadataPath)"
env_file="$(node "${SCRIPT_HELPER_PATH}" resolve-deploy-field envFile)"
proxy_override_path="$(node "${SCRIPT_HELPER_PATH}" resolve-deploy-field proxyOverridePath)"
tmp_checkout="$(mktemp -d "${DEPLOYMENTS_DIR}/.${REPO_SLUG}-${DEPLOYMENT_KEY}-checkout-XXXXXX")"

cleanup() {
  rm -rf "${askpass_root}"
  rm -rf "${tmp_checkout}"
}
trap cleanup EXIT

mkdir -p "$(dirname "${work_dir}")"

# If this target was already deployed, stop the previous stack before replacing
# its working copy. Default-branch volumes are preserved for persistent state.
if [[ -f "${metadata_path}" ]]; then
  previous_project_name="$(node "${SCRIPT_HELPER_PATH}" read-metadata-field "${metadata_path}" projectName)"
  previous_target_type="$(node "${SCRIPT_HELPER_PATH}" read-metadata-field "${metadata_path}" targetType)"
  previous_compose_path="$(node "${SCRIPT_HELPER_PATH}" read-metadata-field "${metadata_path}" composePathResolved)"
  previous_project_directory_resolved="$(node "${SCRIPT_HELPER_PATH}" read-metadata-field "${metadata_path}" projectDirectoryResolved)"
  previous_env_file="$(node "${SCRIPT_HELPER_PATH}" read-metadata-field "${metadata_path}" envFile)"
  previous_proxy_override_path="$(node "${SCRIPT_HELPER_PATH}" read-metadata-field "${metadata_path}" proxyOverridePath)"

  if [[ -n "${previous_project_name}" && -n "${previous_compose_path}" && -f "${previous_compose_path}" ]]; then
    compose_down_args=(
      --project-name "${previous_project_name}"
      --project-directory "${previous_project_directory_resolved:-$(dirname "${previous_compose_path}")}"
      --env-file "${previous_env_file:-${env_file}}"
      -f "${previous_compose_path}"
    )
    if [[ -n "${previous_proxy_override_path}" && -f "${previous_proxy_override_path}" ]]; then
      compose_down_args+=(-f "${previous_proxy_override_path}")
    fi
    if [[ "${previous_target_type}" == "default-branch" ]]; then
      docker compose "${compose_down_args[@]}" down --remove-orphans || true
    else
      docker compose "${compose_down_args[@]}" down -v --remove-orphans || true
    fi
  fi
fi

# TARGET_SHA pins webhook/manual deploys to the exact revision when available.
case "${TARGET_TYPE}" in
  default-branch)
    git clone --depth 1 --branch "${TARGET_VALUE}" "${GITHUB_REPO_URL}" "${tmp_checkout}" >/dev/null
    if [[ -n "${TARGET_SHA:-}" ]]; then
      (
        cd "${tmp_checkout}"
        if ! git checkout "${TARGET_SHA}" >/dev/null 2>&1; then
          git fetch --depth 1 origin "${TARGET_SHA}" >/dev/null 2>&1
          git checkout "${TARGET_SHA}" >/dev/null 2>&1
        fi
      )
    fi
    ;;
  branch)
    git clone --depth 1 --branch "${TARGET_VALUE}" "${GITHUB_REPO_URL}" "${tmp_checkout}" >/dev/null
    if [[ -n "${TARGET_SHA:-}" ]]; then
      (
        cd "${tmp_checkout}"
        if ! git checkout "${TARGET_SHA}" >/dev/null 2>&1; then
          git fetch --depth 1 origin "${TARGET_SHA}" >/dev/null 2>&1
          git checkout "${TARGET_SHA}" >/dev/null 2>&1
        fi
      )
    fi
    ;;
  pr)
    git clone --depth 1 --no-checkout "${GITHUB_REPO_URL}" "${tmp_checkout}" >/dev/null
    (
      cd "${tmp_checkout}"
      git fetch --depth 1 origin "refs/pull/${TARGET_VALUE}/head:preview-pr-${TARGET_VALUE}" >/dev/null 2>&1
      git checkout "preview-pr-${TARGET_VALUE}" >/dev/null 2>&1
    )
    ;;
  *)
    echo "{\"ok\":false,\"message\":\"Unsupported TARGET_TYPE: ${TARGET_TYPE}\"}"
    exit 1
    ;;
esac

# Preserve deployment.json while replacing the checked-out source tree.
mkdir -p "${work_dir}"
find "${work_dir}" -mindepth 1 -maxdepth 1 ! -name 'deployment.json' -exec rm -rf {} +
cp -a "${tmp_checkout}/." "${work_dir}/"

if [[ ! -d "${project_dir}" ]]; then
  echo "{\"ok\":false,\"message\":\"Working directory missing after clone at ${WORKING_DIRECTORY}\"}"
  exit 1
fi

if [[ ! -f "${compose_path_resolved}" ]]; then
  echo "{\"ok\":false,\"message\":\"Compose file missing after clone at ${COMPOSE_PATH}\"}"
  exit 1
fi

# Generate runtime files after clone so Compose sees paths inside the final checkout.
node "${SCRIPT_HELPER_PATH}" write-runtime-env "${env_file}" "${preview_host}" "${project_name}"

if [[ "${APPEND_PROXY_SETTINGS:-false}" == "true" ]]; then
  COMPOSE_ABS_PATH="${compose_path_resolved}" \
    node "${SCRIPT_HELPER_PATH}" write-proxy-override "${proxy_override_path}" "${preview_host}" "${project_name}"
else
  rm -f "${proxy_override_path}"
fi

compose_up_args=(
  --project-name "${project_name}"
  --project-directory "${project_dir}"
  --env-file "${env_file}"
  -f "${compose_path_resolved}"
)
if [[ "${APPEND_PROXY_SETTINGS:-false}" == "true" ]]; then
  compose_up_args+=(-f "${proxy_override_path}")
fi

docker compose "${compose_up_args[@]}" up -d --build

node "${SCRIPT_HELPER_PATH}" write-deployment-metadata "${metadata_path}"
