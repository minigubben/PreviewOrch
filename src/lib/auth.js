const crypto = require("crypto");

const bcrypt = require("bcryptjs");

function ensureCsrfToken(req, res, next) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(24).toString("hex");
  }
  res.locals.csrfToken = req.session.csrfToken;
  res.locals.currentUser = req.session.user || null;
  next();
}

function requireAuth(req, res, next) {
  if (req.session.user) {
    return next();
  }

  if (req.path.startsWith("/api/")) {
    return res.status(401).json({ error: "Authentication required." });
  }

  return res.redirect("/login");
}

function verifyCsrfToken(req, res, next) {
  const candidate = req.get("x-csrf-token") || req.body?._csrf;
  if (candidate && req.session.csrfToken && candidate === req.session.csrfToken) {
    return next();
  }

  if (req.path.startsWith("/api/")) {
    return res.status(403).json({ error: "Invalid CSRF token." });
  }

  return res.status(403).send("Invalid CSRF token.");
}

async function authenticate(username, password, config) {
  if (username !== config.adminUsername || !config.adminPasswordHash) {
    return false;
  }
  return bcrypt.compare(password, config.adminPasswordHash);
}

module.exports = {
  authenticate,
  ensureCsrfToken,
  requireAuth,
  verifyCsrfToken,
};
