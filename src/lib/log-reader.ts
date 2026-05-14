// @ts-nocheck
import fs from "node:fs/promises";

import { trimLines } from "./utils.js";

async function readLogTail(filePath, maxLines = 40) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return trimLines(raw, maxLines);
  } catch (error) {
    if (error.code === "ENOENT") {
      return "";
    }
    throw error;
  }
}

export { readLogTail };
