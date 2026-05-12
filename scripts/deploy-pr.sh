#!/usr/bin/env bash
set -euo pipefail

required_vars=(
  REPO_ID
  REPO_OWNER
  REPO_NAME
  REPO_SLUG
  SOURCE_CLONE_SSH_URL
  COMPOSE_PATH
  PUBLIC_SERVICE
  PUBLIC_PORT
  PR_NUMBER
  PR_BRANCH
  PR_SHA
  BASE_DOMAIN
  DEPLOYMENTS_DIR
)

for var_name in "${required_vars[@]}"; do
  if [[ -z "${!var_name:-}" ]]; then
    echo "{\"ok\":false,\"message\":\"Missing required environment variable: ${var_name}\"}"
    exit 1
  fi
done

if [[ -n "${SSH_DIR:-}" ]]; then
  if [[ -f "${SSH_DIR}/id_ed25519" ]]; then
    export GIT_SSH_COMMAND="ssh -i ${SSH_DIR}/id_ed25519 -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new"
  elif [[ -f "${SSH_DIR}/id_rsa" ]]; then
    export GIT_SSH_COMMAND="ssh -i ${SSH_DIR}/id_rsa -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new"
  fi
fi

project_name="$(node -e 'const input = `${process.env.REPO_SLUG}-pr-${process.env.PR_NUMBER}`; process.stdout.write(input.replace(/[^a-z0-9_-]+/g, "-").slice(0, 55));')"
preview_host="${REPO_SLUG}-pr-${PR_NUMBER}.${BASE_DOMAIN}"
deployment_id="${REPO_ID}-pr-${PR_NUMBER}"
work_dir="${DEPLOYMENTS_DIR}/${REPO_SLUG}/pr-${PR_NUMBER}"
compose_path_resolved="${work_dir}/${COMPOSE_PATH}"
metadata_path="${work_dir}/deployment.json"
env_file="${work_dir}/.env.runtime"
proxy_override_path="${work_dir}/.orchestrator-proxy.override.yml"

mkdir -p "$(dirname "${work_dir}")"

if [[ -f "${metadata_path}" ]]; then
  previous_project_name="$(METADATA_PATH="${metadata_path}" node -e 'const fs = require("fs"); const m = JSON.parse(fs.readFileSync(process.env.METADATA_PATH, "utf8")); process.stdout.write(String(m.projectName || ""));')"
  previous_compose_path="$(METADATA_PATH="${metadata_path}" node -e 'const fs = require("fs"); const m = JSON.parse(fs.readFileSync(process.env.METADATA_PATH, "utf8")); process.stdout.write(String(m.composePathResolved || ""));')"
  previous_env_file="$(METADATA_PATH="${metadata_path}" node -e 'const fs = require("fs"); const m = JSON.parse(fs.readFileSync(process.env.METADATA_PATH, "utf8")); process.stdout.write(String(m.envFile || ""));')"
  previous_proxy_override_path="$(METADATA_PATH="${metadata_path}" node -e 'const fs = require("fs"); const m = JSON.parse(fs.readFileSync(process.env.METADATA_PATH, "utf8")); process.stdout.write(String(m.proxyOverridePath || ""));')"

  if [[ -n "${previous_project_name}" && -n "${previous_compose_path}" && -f "${previous_compose_path}" ]]; then
    compose_down_args=(
      --project-name "${previous_project_name}"
      --env-file "${previous_env_file:-${env_file}}"
      -f "${previous_compose_path}"
    )
    if [[ -n "${previous_proxy_override_path}" && -f "${previous_proxy_override_path}" ]]; then
      compose_down_args+=(-f "${previous_proxy_override_path}")
    fi
    docker compose "${compose_down_args[@]}" down -v --remove-orphans || true
  fi
fi

rm -rf "${work_dir}"

git clone --depth 1 --branch "${PR_BRANCH}" "${SOURCE_CLONE_SSH_URL}" "${work_dir}" >/dev/null
(
  cd "${work_dir}"
  if ! git checkout "${PR_SHA}" >/dev/null 2>&1; then
    git fetch --depth 1 origin "${PR_SHA}" >/dev/null 2>&1
    git checkout "${PR_SHA}" >/dev/null 2>&1
  fi
)

if [[ ! -f "${compose_path_resolved}" ]]; then
  echo "{\"ok\":false,\"message\":\"Compose file missing after clone at ${COMPOSE_PATH}\"}"
  exit 1
fi

PROJECT_NAME="${project_name}" \
PREVIEW_HOST="${preview_host}" \
ENV_FILE="${env_file}" \
node <<'NODE'
const fs = require("fs");

const reserved = {
  ORCH_PROJECT_NAME: process.env.PROJECT_NAME,
  ORCH_PREVIEW_HOST: process.env.PREVIEW_HOST,
  ORCH_PREVIEW_SERVICE_PORT: process.env.PUBLIC_PORT,
  ORCH_PR_NUMBER: process.env.PR_NUMBER,
  ORCH_PR_BRANCH: process.env.PR_BRANCH,
  ORCH_PR_SHA: process.env.PR_SHA,
  ORCH_REPO_SLUG: process.env.REPO_SLUG,
};

const lines = [];
for (const [key, value] of Object.entries(reserved)) {
  lines.push(`${key}=${String(value ?? "")}`);
}

const previewHostEnvVarName = String(process.env.PREVIEW_HOST_ENV_VAR_NAME || "").trim();
if (previewHostEnvVarName) {
  lines.push(`${previewHostEnvVarName}=${process.env.PREVIEW_HOST}`);
}

const extraEnv = JSON.parse(process.env.EXTRA_ENV_JSON || "{}");
for (const [key, value] of Object.entries(extraEnv)) {
  lines.push(`${key}=${String(value ?? "")}`);
}

fs.writeFileSync(process.env.ENV_FILE, `${lines.join("\n")}\n`, "utf8");
NODE

if [[ "${APPEND_PROXY_SETTINGS:-false}" == "true" ]]; then
  PROJECT_NAME="${project_name}" \
  PREVIEW_HOST="${preview_host}" \
  PROXY_OVERRIDE_PATH="${proxy_override_path}" \
  node <<'NODE'
const fs = require("fs");
const YAML = require("yaml");

const doc = {
  services: {
    [process.env.PUBLIC_SERVICE]: {
      networks: [process.env.TRAEFIK_NETWORK_NAME],
      labels: [
        "traefik.enable=true",
        `traefik.docker.network=${process.env.TRAEFIK_NETWORK_NAME}`,
        `traefik.http.routers.\${ORCH_PROJECT_NAME}.rule=Host(\`${process.env.PREVIEW_HOST}\`)`,
        "traefik.http.routers.${ORCH_PROJECT_NAME}.entrypoints=web",
        "traefik.http.services.${ORCH_PROJECT_NAME}.loadbalancer.server.port=${ORCH_PREVIEW_SERVICE_PORT}",
      ],
    },
  },
  networks: {
    [process.env.TRAEFIK_NETWORK_NAME]: {
      external: true,
      name: process.env.TRAEFIK_NETWORK_NAME,
    },
  },
};

fs.writeFileSync(process.env.PROXY_OVERRIDE_PATH, YAML.stringify(doc), "utf8");
NODE
else
  rm -f "${proxy_override_path}"
fi

compose_up_args=(
  --project-name "${project_name}"
  --env-file "${env_file}"
  -f "${compose_path_resolved}"
)
if [[ "${APPEND_PROXY_SETTINGS:-false}" == "true" ]]; then
  compose_up_args+=(-f "${proxy_override_path}")
fi
docker compose "${compose_up_args[@]}" up -d --build

DEPLOYMENT_ID="${deployment_id}" \
PREVIEW_HOST="${preview_host}" \
PROJECT_NAME="${project_name}" \
WORK_DIR="${work_dir}" \
COMPOSE_PATH_RESOLVED="${compose_path_resolved}" \
PROXY_OVERRIDE_PATH="${proxy_override_path}" \
METADATA_PATH="${metadata_path}" \
ENV_FILE="${env_file}" \
node <<'NODE'
const fs = require("fs");

const metadata = {
  deploymentId: process.env.DEPLOYMENT_ID,
  repoId: process.env.REPO_ID,
  repoSlug: process.env.REPO_SLUG,
  prNumber: Number(process.env.PR_NUMBER),
  prBranch: process.env.PR_BRANCH,
  prSha: process.env.PR_SHA,
  previewHost: process.env.PREVIEW_HOST,
  projectName: process.env.PROJECT_NAME,
  workDir: process.env.WORK_DIR,
  composePathResolved: process.env.COMPOSE_PATH_RESOLVED,
  proxyOverridePath: process.env.APPEND_PROXY_SETTINGS === "true" ? process.env.PROXY_OVERRIDE_PATH : "",
  sourceCloneSshUrl: process.env.SOURCE_CLONE_SSH_URL,
  status: "running",
  lastEvent: process.env.LAST_EVENT || "deploy",
  envFile: process.env.ENV_FILE,
  logFile: process.env.LOG_FILE || "",
  publicService: process.env.PUBLIC_SERVICE,
  publicPort: Number(process.env.PUBLIC_PORT),
  appendProxySettings: process.env.APPEND_PROXY_SETTINGS === "true",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

fs.writeFileSync(process.env.METADATA_PATH, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
console.log(JSON.stringify(metadata));
NODE
