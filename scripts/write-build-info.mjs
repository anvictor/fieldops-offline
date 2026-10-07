import { writeFile } from "node:fs/promises";
import { validateSha } from "./smoke-config.mjs";

const sha = validateSha(process.argv[2]);
await writeFile(new URL("../dist/build-info.json", import.meta.url),
  JSON.stringify({ schemaVersion: 1, sha }) + "\n");
