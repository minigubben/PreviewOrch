const fs = require("fs/promises");

const { trimLines } = require("./utils");

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

module.exports = {
  readLogTail,
};
