// @ts-nocheck
import express from "express";

import { asyncHandler, createRateLimit } from "../lib/http.js";
import { buildWebhookContext, verifyGithubSignature } from "../lib/github.js";

function createGithubWebhookRouter({ githubAppStore, deploymentService, logger }) {
  const router = express.Router();
  const webhookRateLimit = createRateLimit({
    keyPrefix: "github-webhook",
    maxRequests: 300,
    windowMs: 60 * 1000,
    onLimit: (req, res, retryAfterSeconds) => {
      void req;
      return res.status(429).json({
        error: "Too many webhook requests.",
        retryAfterSeconds,
      });
    },
  });

  router.post(
    "/webhooks/github",
    webhookRateLimit,
    express.raw({ type: "application/json" }),
    asyncHandler(async (req, res) => {
      const githubApp = await githubAppStore.getGithubApp();
      if (!githubApp?.webhookSecret) {
        return res.status(503).json({ error: "GitHub App is not configured." });
      }

      const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from("");
      const signature = req.get("x-hub-signature-256") || req.get("x-hub-signature");
      const eventName = req.get("x-github-event");

      if (!verifyGithubSignature(rawBody, signature, githubApp.webhookSecret)) {
        await logger.warn("Rejected webhook due to invalid signature");
        return res.status(401).json({ error: "Invalid signature." });
      }

      let payload;
      try {
        payload = JSON.parse(rawBody.toString("utf8"));
      } catch {
        return res.status(400).json({ error: "Invalid JSON payload." });
      }

      if (eventName === "ping") {
        await logger.info("Accepted GitHub webhook ping", {
          hookId: payload.hook_id || null,
          zen: payload.zen || "",
        });
        return res.json({
          ok: true,
          event: "ping",
          zen: payload.zen || "",
          hookId: payload.hook_id || null,
        });
      }

      if (eventName !== "pull_request") {
        await logger.info("Ignored unsupported GitHub event", { eventName });
        return res.json({ ignored: true });
      }

      const webhookContext = buildWebhookContext(payload);
      const result = await deploymentService.handleWebhook(webhookContext);
      if (result?.accepted) {
        return res.status(202).json(result);
      }
      return res.json(result || { ignored: true });
    }),
  );

  return router;
}

export { createGithubWebhookRouter };
