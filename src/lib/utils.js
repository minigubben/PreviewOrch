function slugifyRepo(owner, name) {
  return `${owner}-${name}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

function buildPreviewHost(repoSlug, prNumber, baseDomain) {
  return `${repoSlug}-pr-${prNumber}.${baseDomain}`;
}

function buildProjectName(repoSlug, prNumber) {
  return `${repoSlug}-pr-${prNumber}`.replace(/[^a-z0-9_-]+/g, "-").slice(0, 55);
}

function asArray(value) {
  if (Array.isArray(value)) {
    return value;
  }
  if (value === undefined || value === null) {
    return [];
  }
  return [value];
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
  asArray,
  buildPreviewHost,
  buildProjectName,
  formatTimestamp,
  normalizeBoolean,
  slugifyRepo,
  trimLines,
};
