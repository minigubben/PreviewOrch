const express = require("express");

const { authenticate, requireAuth, verifyCsrfToken } = require("../lib/auth");
const { setNoStore } = require("../lib/http");

function createAuthRouter({ config, assetVersion }) {
  const router = express.Router();

  router.get("/login", (req, res) => {
    if (req.session.user) {
      return res.redirect("/");
    }
    setNoStore(res);
    return res.render("login", { error: null, assetVersion });
  });

  router.post("/login", verifyCsrfToken, async (req, res) => {
    const { username, password } = req.body;
    const success = await authenticate(username, password, config);
    if (!success) {
      return res.status(401).render("login", { error: "Invalid username or password." });
    }

    req.session.user = { username };
    return res.redirect("/");
  });

  router.post("/logout", verifyCsrfToken, requireAuth, (req, res) => {
    req.session.destroy(() => {
      res.redirect("/login");
    });
  });

  return router;
}

module.exports = {
  createAuthRouter,
};
