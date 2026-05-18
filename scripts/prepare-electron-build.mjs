import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const standaloneDir = path.join(root, ".next", "standalone");

async function copyIfExists(from, to) {
  try {
    await fs.rm(to, { recursive: true, force: true });
    await fs.cp(from, to, { recursive: true });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return;
    throw error;
  }
}

await copyIfExists(path.join(root, ".next", "static"), path.join(standaloneDir, ".next", "static"));
await copyIfExists(path.join(root, "public"), path.join(standaloneDir, "public"));
