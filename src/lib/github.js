const crypto = require("crypto");

function verifyGithubSignature(rawBody, signatureHeader, secret) {
  if (!secret || !signatureHeader || !signatureHeader.startsWith("sha256=")) {
    return false;
  }

  const digest = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  const expected = Buffer.from(`sha256=${digest}`);
  const actual = Buffer.from(signatureHeader);

  if (expected.length !== actual.length) {
    return false;
  }

  return crypto.timingSafeEqual(expected, actual);
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
    headRepoFullName: headRepo.full_name,
    sourceCloneSshUrl: headRepo.ssh_url || baseRepo.ssh_url,
    raw: payload,
  };
}

module.exports = {
  buildWebhookContext,
  mapPullRequestAction,
  verifyGithubSignature,
};
