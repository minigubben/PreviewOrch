// @ts-nocheck
import express from "express";

import { authenticate, requireAuth, verifyCsrfToken } from "../lib/auth.js";
import { BRANDING } from "../lib/branding.js";
import { setNoStore } from "../lib/http.js";

function createAuthRouter({ config, clientAssets }) {
  const router = express.Router();

  router.get("/login", (req, res) => {
    if (req.session.user) {
      return res.redirect("/");
    }
    setNoStore(res);
    return res.render("login", { error: null, clientAssets, brand: BRANDING });
  });

  router.post("/login", verifyCsrfToken, async (req, res) => {
    const { username, password } = req.body;
    const success = await authenticate(username, password, config);
    if (!success) {
      return res.status(401).render("login", { error: "Invalid username or password.", clientAssets, brand: BRANDING });
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

export {
  createAuthRouter,
};
