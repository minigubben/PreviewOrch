#!/usr/bin/env bash
set -euo pipefail

if [[ "$#" -lt 1 ]]; then
  echo "Usage: scripts/run-shell-tool.sh <tool> [args...]" >&2
  exit 2
fi

tool_name="$1"
shift

if tool_path="$(command -v "${tool_name}" 2>/dev/null)"; then
  exec "${tool_path}" "$@"
fi

candidate_dirs=(
  "/usr/local/bin"
  "/usr/bin"
  "/opt/homebrew/bin"
)

if [[ -n "${HOME:-}" ]]; then
  candidate_dirs+=("${HOME}/go/bin")
fi

for candidate_dir in "${candidate_dirs[@]}"; do
  if [[ -x "${candidate_dir}/${tool_name}" ]]; then
    exec "${candidate_dir}/${tool_name}" "$@"
  fi
done

case "${tool_name}" in
  shellcheck)
    echo "shellcheck is required. Install it from https://www.shellcheck.net/" >&2
    ;;
  shfmt)
    echo "shfmt is required. Install it from https://github.com/mvdan/sh" >&2
    ;;
  *)
    echo "${tool_name} is required but was not found." >&2
    ;;
esac

echo "PATH was: ${PATH:-}" >&2
exit 127
