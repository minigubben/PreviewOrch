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

mkdir -p "$(dirname "${work_dir}")"

if [[ -f "${metadata_path}" ]]; then
  previous_project_name="$(METADATA_PATH="${metadata_path}" node -e 'const fs = require("fs"); const m = JSON.parse(fs.readFileSync(process.env.METADATA_PATH, "utf8")); process.stdout.write(String(m.projectName || ""));')"
  previous_compose_path="$(METADATA_PATH="${metadata_path}" node -e 'const fs = require("fs"); const m = JSON.parse(fs.readFileSync(process.env.METADATA_PATH, "utf8")); process.stdout.write(String(m.composePathResolved || ""));')"
  previous_env_file="$(METADATA_PATH="${metadata_path}" node -e 'const fs = require("fs"); const m = JSON.parse(fs.readFileSync(process.env.METADATA_PATH, "utf8")); process.stdout.write(String(m.envFile || ""));')"

  if [[ -n "${previous_project_name}" && -n "${previous_compose_path}" && -f "${previous_compose_path}" ]]; then
    docker compose \
      --project-name "${previous_project_name}" \
      --env-file "${previous_env_file:-${env_file}}" \
      -f "${previous_compose_path}" \
      down -v --remove-orphans || true
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

cat > "${env_file}" <<EOF
ORCH_PROJECT_NAME=${project_name}
ORCH_PREVIEW_HOST=${preview_host}
ORCH_PREVIEW_SERVICE_PORT=${PUBLIC_PORT}
ORCH_PR_NUMBER=${PR_NUMBER}
ORCH_PR_BRANCH=${PR_BRANCH}
ORCH_PR_SHA=${PR_SHA}
ORCH_REPO_SLUG=${REPO_SLUG}
EOF

docker compose \
  --project-name "${project_name}" \
  --env-file "${env_file}" \
  -f "${compose_path_resolved}" \
  up -d --build

DEPLOYMENT_ID="${deployment_id}" \
PREVIEW_HOST="${preview_host}" \
PROJECT_NAME="${project_name}" \
WORK_DIR="${work_dir}" \
COMPOSE_PATH_RESOLVED="${compose_path_resolved}" \
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
  sourceCloneSshUrl: process.env.SOURCE_CLONE_SSH_URL,
  status: "running",
  lastEvent: process.env.LAST_EVENT || "deploy",
  envFile: process.env.ENV_FILE,
  logFile: process.env.LOG_FILE || "",
  publicService: process.env.PUBLIC_SERVICE,
  publicPort: Number(process.env.PUBLIC_PORT),
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

fs.writeFileSync(process.env.METADATA_PATH, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
console.log(JSON.stringify(metadata));
NODE
