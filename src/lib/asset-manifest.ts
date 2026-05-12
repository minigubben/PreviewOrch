import fs from "node:fs/promises";

import type { ClientAssets } from "../types/domain.js";

interface ViteManifestEntry {
  file?: string;
  css?: string[];
  isEntry?: boolean;
  src?: string;
}

export async function loadClientAssets(
  manifestPath: string,
  fallback: ClientAssets = { js: [], css: [] },
): Promise<ClientAssets> {
  try {
    const raw = await fs.readFile(manifestPath, "utf8");
    return parseClientAssets(raw, fallback);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return fallback;
    }
    throw error;
  }
}

export function parseClientAssets(
  manifestRaw: string,
  fallback: ClientAssets = { js: [], css: [] },
): ClientAssets {
  let manifest: Record<string, ViteManifestEntry>;
  try {
    manifest = JSON.parse(manifestRaw) as Record<string, ViteManifestEntry>;
  } catch {
    return fallback;
  }

  const entry = Object.entries(manifest).find(([, value]) => value.isEntry)?.[1];
  if (!entry?.file) {
    return fallback;
  }

  return {
    js: [normalizeAsset(entry.file)],
    css: (entry.css || []).map(normalizeAsset),
  };
}

function normalizeAsset(file: string): string {
  return `/static/${file.replace(/^\/+/, "")}`;
}
