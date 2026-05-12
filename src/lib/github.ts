// @ts-nocheck
import crypto from "node:crypto";

function verifyGithubSignature(rawBody, signatureHeader, secret) {
  const normalizedSecret = normalizeWebhookSecret(secret);
  if (!normalizedSecret || !signatureHeader) {
    return false;
  }

  const parsed = parseSignatureHeader(signatureHeader);
  if (!parsed) {
    return false;
  }

  const digest = crypto.createHmac(parsed.algorithm, normalizedSecret).update(rawBody).digest("hex");
  const expected = Buffer.from(`${parsed.prefix}=${digest}`);
  const actual = Buffer.from(signatureHeader);

  if (expected.length !== actual.length) {
    return false;
  }

  return crypto.timingSafeEqual(expected, actual);
}

function parseSignatureHeader(signatureHeader) {
  if (typeof signatureHeader !== "string") {
    return null;
  }

  if (signatureHeader.startsWith("sha256=")) {
    return {
      algorithm: "sha256",
      prefix: "sha256",
    };
  }

  if (signatureHeader.startsWith("sha1=")) {
    return {
      algorithm: "sha1",
      prefix: "sha1",
    };
  }

  return null;
}

function normalizeWebhookSecret(secret) {
  const value = String(secret || "").trim();
  if (!value) {
    return "";
  }

  if (
    (value.startsWith("'") && value.endsWith("'")) ||
    (value.startsWith('"') && value.endsWith('"'))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

function mapPullRequestAction(action) {
  if (["opened", "reopened", "synchronize"].includes(action)) {
    return "deploy";
  }
  if (action === "closed") {
    return "destroy";
  }
  return null;
}

function buildWebhookContext(payload) {
  const pr = payload.pull_request || {};
  const headRepo = pr.head?.repo || {};
  const baseRepo = payload.repository || {};

  return {
    action: payload.action,
    mappedAction: mapPullRequestAction(payload.action),
    repoFullName: baseRepo.full_name,
    repoOwner: baseRepo.owner?.login,
    repoName: baseRepo.name,
    prNumber: pr.number || payload.number,
    prBranch: pr.head?.ref,
    prSha: pr.head?.sha,
    prAuthorLogin: pr.user?.login,
    prAuthorAssociation: pr.author_association || payload.author_association || "",
    senderLogin: payload.sender?.login || "",
    headRepoFullName: headRepo.full_name,
    sourceCloneSshUrl: headRepo.ssh_url || baseRepo.ssh_url,
    raw: payload,
  };
}

export {
  buildWebhookContext,
  mapPullRequestAction,
  normalizeWebhookSecret,
  verifyGithubSignature,
};
