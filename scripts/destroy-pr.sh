#!/usr/bin/env bash
set -euo pipefail

SCRIPT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT_HELPER_PATH="${SCRIPT_ROOT}/dist/src/cli/script-helper.js"

if [[ -z "${DEPLOYMENT_METADATA_PATH:-}" ]]; then
  echo "{\"ok\":false,\"message\":\"Missing required environment variable: DEPLOYMENT_METADATA_PATH\"}"
  exit 1
fi

if [[ ! -f "${DEPLOYMENT_METADATA_PATH}" ]]; then
  echo "{\"ok\":true,\"destroyed\":false,\"reason\":\"metadata-missing\"}"
  exit 0
fi

deployment_id="$(node "${SCRIPT_HELPER_PATH}" read-metadata-field "${DEPLOYMENT_METADATA_PATH}" deploymentId)"
target_type="$(node "${SCRIPT_HELPER_PATH}" read-metadata-field "${DEPLOYMENT_METADATA_PATH}" targetType)"
project_name="$(node "${SCRIPT_HELPER_PATH}" read-metadata-field "${DEPLOYMENT_METADATA_PATH}" projectName)"
compose_path_resolved="$(node "${SCRIPT_HELPER_PATH}" read-metadata-field "${DEPLOYMENT_METADATA_PATH}" composePathResolved)"
project_directory_resolved="$(node "${SCRIPT_HELPER_PATH}" read-metadata-field "${DEPLOYMENT_METADATA_PATH}" projectDirectoryResolved)"
work_dir="$(node "${SCRIPT_HELPER_PATH}" read-metadata-field "${DEPLOYMENT_METADATA_PATH}" workDir)"
env_file="$(node "${SCRIPT_HELPER_PATH}" read-metadata-field "${DEPLOYMENT_METADATA_PATH}" envFile)"
proxy_override_path="$(node "${SCRIPT_HELPER_PATH}" read-metadata-field "${DEPLOYMENT_METADATA_PATH}" proxyOverridePath)"

if [[ -n "${project_name}" && -n "${compose_path_resolved}" && -f "${compose_path_resolved}" ]]; then
  compose_down_args=(
    --project-name "${project_name}"
    --project-directory "${project_directory_resolved:-$(dirname "${compose_path_resolved}")}"
    --env-file "${env_file:-${work_dir}/.env.runtime}"
    -f "${compose_path_resolved}"
  )
  if [[ -n "${proxy_override_path}" && -f "${proxy_override_path}" ]]; then
    compose_down_args+=(-f "${proxy_override_path}")
  fi
  if [[ "${target_type}" == "default-branch" ]]; then
    docker compose "${compose_down_args[@]}" down --remove-orphans || true
  else
    docker compose "${compose_down_args[@]}" down -v --remove-orphans || true
  fi
fi

if [[ -n "${work_dir}" ]]; then
  rm -rf "${work_dir}"
fi

echo "{\"ok\":true,\"destroyed\":true,\"deploymentId\":\"${deployment_id}\"}"
