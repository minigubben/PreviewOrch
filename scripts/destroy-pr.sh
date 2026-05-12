#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${DEPLOYMENT_METADATA_PATH:-}" ]]; then
  echo "{\"ok\":false,\"message\":\"Missing required environment variable: DEPLOYMENT_METADATA_PATH\"}"
  exit 1
fi

if [[ ! -f "${DEPLOYMENT_METADATA_PATH}" ]]; then
  echo "{\"ok\":true,\"destroyed\":false,\"reason\":\"metadata-missing\"}"
  exit 0
fi

deployment_id="$(node -e 'const fs = require("fs"); const m = JSON.parse(fs.readFileSync(process.env.DEPLOYMENT_METADATA_PATH, "utf8")); process.stdout.write(String(m.deploymentId || ""));')"
project_name="$(node -e 'const fs = require("fs"); const m = JSON.parse(fs.readFileSync(process.env.DEPLOYMENT_METADATA_PATH, "utf8")); process.stdout.write(String(m.projectName || ""));')"
compose_path_resolved="$(node -e 'const fs = require("fs"); const m = JSON.parse(fs.readFileSync(process.env.DEPLOYMENT_METADATA_PATH, "utf8")); process.stdout.write(String(m.composePathResolved || ""));')"
work_dir="$(node -e 'const fs = require("fs"); const m = JSON.parse(fs.readFileSync(process.env.DEPLOYMENT_METADATA_PATH, "utf8")); process.stdout.write(String(m.workDir || ""));')"
env_file="$(node -e 'const fs = require("fs"); const m = JSON.parse(fs.readFileSync(process.env.DEPLOYMENT_METADATA_PATH, "utf8")); process.stdout.write(String(m.envFile || ""));')"
proxy_override_path="$(node -e 'const fs = require("fs"); const m = JSON.parse(fs.readFileSync(process.env.DEPLOYMENT_METADATA_PATH, "utf8")); process.stdout.write(String(m.proxyOverridePath || ""));')"

if [[ -n "${project_name}" && -n "${compose_path_resolved}" && -f "${compose_path_resolved}" ]]; then
  compose_down_args=(
    --project-name "${project_name}"
    --env-file "${env_file:-${work_dir}/.env.runtime}"
    -f "${compose_path_resolved}"
  )
  if [[ -n "${proxy_override_path}" && -f "${proxy_override_path}" ]]; then
    compose_down_args+=(-f "${proxy_override_path}")
  fi
  docker compose "${compose_down_args[@]}" down -v --remove-orphans || true
fi

if [[ -n "${work_dir}" ]]; then
  rm -rf "${work_dir}"
fi

echo "{\"ok\":true,\"destroyed\":true,\"deploymentId\":\"${deployment_id}\"}"
