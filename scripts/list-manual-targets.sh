#!/usr/bin/env bash
set -euo pipefail

# Return branch and PR choices as JSON for the manual deploy target picker.
required_vars=(
  REPO_FULL_NAME
  GITHUB_REPO_URL
  GITHUB_INSTALLATION_ID
  GITHUB_INSTALLATION_TOKEN
)

for var_name in "${required_vars[@]}"; do
  if [[ -z "${!var_name:-}" ]]; then
    echo "{\"ok\":false,\"message\":\"Missing required environment variable: ${var_name}\"}"
    exit 1
  fi
done

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

# GitHub exposes pull request refs as refs/pull/<number>/merge.
branches_text="$(
  git ls-remote --heads "${GITHUB_REPO_URL}" |
    awk '{print $2}' |
    sed -e 's#^refs/heads/##' -e '/^$/d' |
    sort -u
)"

prs_text="$(
  git ls-remote "${GITHUB_REPO_URL}" "refs/pull/*/merge" |
    awk '{print $2}' |
    sed -n 's#^refs/pull/\([0-9]\+\)/merge$#\1#p' |
    sort -n -u
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

// Include the configured default branch even if a provider omits it from refs.
if (defaultBranch) {
  branchSet.add(defaultBranch);
}

// Keep the response bounded so the UI stays quick for large repositories.
const branches = Array.from(branchSet).slice(0, 300);
const pullRequests = prLines.slice(0, 300).map((number) => ({
  number,
  label: `PR #${number}`,
}));

process.stdout.write(`${JSON.stringify({ ok: true, branches, pullRequests })}\n`);
NODE
