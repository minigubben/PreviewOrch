// @ts-nocheck
function asyncHandler(handler) {
  return function wrappedHandler(req, res, next) {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

function createRateLimit({ keyPrefix, maxRequests, windowMs, onLimit }) {
  const entries = new Map();

  return function rateLimit(req, res, next) {
    const key = `${keyPrefix}:${String(req.ip || req.socket?.remoteAddress || "unknown")}`;
    const now = Date.now();
    const existing = entries.get(key);
    const current =
      existing && existing.resetAt > now
        ? existing
        : {
            count: 0,
            resetAt: now + windowMs,
          };

    current.count += 1;
    entries.set(key, current);

    if (entries.size > 1000) {
      for (const [entryKey, entryValue] of entries.entries()) {
        if (entryValue.resetAt <= now) {
          entries.delete(entryKey);
        }
      }
    }

    if (current.count <= maxRequests) {
      return next();
    }

    const retryAfterSeconds = Math.max(1, Math.ceil((current.resetAt - now) / 1000));
    res.setHeader("Retry-After", String(retryAfterSeconds));
    return onLimit(req, res, retryAfterSeconds);
  };
}

function setNoStore(res) {
  res.setHeader("Cache-Control", "no-store");
}

export { asyncHandler, createRateLimit, setNoStore };
