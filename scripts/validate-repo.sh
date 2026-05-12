#!/usr/bin/env bash
set -euo pipefail

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

if [[ -n "${SSH_DIR:-}" ]]; then
  if [[ -f "${SSH_DIR}/id_ed25519" ]]; then
    export GIT_SSH_COMMAND="ssh -i ${SSH_DIR}/id_ed25519 -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new"
  elif [[ -f "${SSH_DIR}/id_rsa" ]]; then
    export GIT_SSH_COMMAND="ssh -i ${SSH_DIR}/id_rsa -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new"
  fi
fi

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

COMPOSE_ABS_PATH="${compose_file}" node <<'NODE'
const fs = require("fs");
const YAML = require("yaml");

const publicService = process.env.PUBLIC_SERVICE;
const appendProxySettings = String(process.env.APPEND_PROXY_SETTINGS || "false").toLowerCase() === "true";

function fail(message) {
  console.log(JSON.stringify({ ok: false, message }));
  process.exit(1);
}

const raw = fs.readFileSync(process.env.COMPOSE_ABS_PATH, "utf8");
const doc = YAML.parse(raw);

if (!doc || typeof doc !== "object" || !doc.services || typeof doc.services !== "object") {
  fail("Compose file must contain a services object.");
}

const service = doc.services[publicService];
if (!service) {
  fail(`Configured public service '${publicService}' was not found in compose file.`);
}

if (appendProxySettings) {
  console.log(JSON.stringify({ ok: true, message: "Repository validation passed." }));
  process.exit(0);
}

const labels = [];
if (Array.isArray(service.labels)) {
  labels.push(...service.labels.map(String));
} else if (service.labels && typeof service.labels === "object") {
  for (const [key, value] of Object.entries(service.labels)) {
    labels.push(`${key}=${value}`);
  }
}

const requirements = [
  { needle: "traefik.enable=true", label: "traefik.enable=true" },
  { needle: "${ORCH_PREVIEW_HOST}", label: "${ORCH_PREVIEW_HOST}" },
  { needle: "${ORCH_PROJECT_NAME}", label: "${ORCH_PROJECT_NAME}" },
  { needle: "${ORCH_PREVIEW_SERVICE_PORT}", label: "${ORCH_PREVIEW_SERVICE_PORT}" },
];

for (const requirement of requirements) {
  if (!labels.some((label) => label.includes(requirement.needle))) {
    fail(`Missing required Traefik label contract token: ${requirement.label}`);
  }
}

console.log(JSON.stringify({ ok: true, message: "Repository validation passed." }));
NODE
