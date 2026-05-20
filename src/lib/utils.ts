import type { TargetType } from "../types/domain.js";

function slugifyRepo(owner: string, name: string): string {
  return toHyphenSlug(`${owner}-${name}`);
}

function slugifyValue(value: string | number): string {
  return toHyphenSlug(String(value));
}

function buildDeploymentKey(targetType: TargetType, targetValue: string | number): string {
  if (targetType === "pr") {
    return `pr-${Number(targetValue)}`;
  }
  if (targetType === "branch") {
    return `branch-${slugifyValue(targetValue).slice(0, 32)}`;
  }
  if (targetType === "default-branch") {
    return "default-branch";
  }
  throw new Error(`Unsupported targetType: ${targetType}`);
}

function buildPreviewHost(
  repoSlug: string,
  deploymentKey: string,
  baseDomain: string,
  customHost = "",
): string {
  if (customHost) {
    return String(customHost).trim().toLowerCase();
  }
  return `${repoSlug}-${deploymentKey}.${baseDomain}`;
}

function buildProjectName(repoSlug: string, deploymentKey: string): string {
  return `${repoSlug}-${deploymentKey}`.replace(/[^a-z0-9_-]+/g, "-").slice(0, 55);
}

function formatTimestamp(date = new Date()): string {
  return date.toISOString();
}

function normalizeBoolean(value: boolean | string | number | null | undefined): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    return ["1", "true", "on", "yes"].includes(value.toLowerCase());
  }
  return Boolean(value);
}

function trimLines(text: string, maxLines = 40): string {
  const lines = String(text || "")
    .trimEnd()
    .split("\n");
  return lines.slice(Math.max(0, lines.length - maxLines)).join("\n");
}

function toHyphenSlug(value: string): string {
  let result = "";
  let previousWasHyphen = false;

  for (const character of String(value).toLowerCase()) {
    const code = character.charCodeAt(0);
    const isAsciiLetter = code >= 97 && code <= 122;
    const isAsciiDigit = code >= 48 && code <= 57;

    if (isAsciiLetter || isAsciiDigit) {
      result += character;
      previousWasHyphen = false;
      continue;
    }

    if (!previousWasHyphen && result) {
      result += "-";
      previousWasHyphen = true;
    }
  }

  return previousWasHyphen ? result.slice(0, -1) : result;
}

export {
  buildPreviewHost,
  buildProjectName,
  buildDeploymentKey,
  formatTimestamp,
  normalizeBoolean,
  slugifyRepo,
  slugifyValue,
  trimLines,
};
