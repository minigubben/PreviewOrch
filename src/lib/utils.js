function slugifyRepo(owner, name) {
  return `${owner}-${name}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

function slugifyValue(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

function buildDeploymentKey(targetType, targetValue) {
  if (targetType === "pr") {
    return `pr-${Number(targetValue)}`;
  }
  if (targetType === "branch") {
    return `branch-${slugifyValue(targetValue).slice(0, 32)}`;
  }
  throw new Error(`Unsupported targetType: ${targetType}`);
}

function buildPreviewHost(repoSlug, deploymentKey, baseDomain) {
  return `${repoSlug}-${deploymentKey}.${baseDomain}`;
}

function buildProjectName(repoSlug, deploymentKey) {
  return `${repoSlug}-${deploymentKey}`.replace(/[^a-z0-9_-]+/g, "-").slice(0, 55);
}

function formatTimestamp(date = new Date()) {
  return date.toISOString();
}

function normalizeBoolean(value) {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    return ["1", "true", "on", "yes"].includes(value.toLowerCase());
  }
  return Boolean(value);
}

function trimLines(text, maxLines = 40) {
  const lines = String(text || "").trimEnd().split("\n");
  return lines.slice(Math.max(0, lines.length - maxLines)).join("\n");
}

module.exports = {
  buildPreviewHost,
  buildProjectName,
  buildDeploymentKey,
  formatTimestamp,
  normalizeBoolean,
  slugifyRepo,
  slugifyValue,
  trimLines,
};
