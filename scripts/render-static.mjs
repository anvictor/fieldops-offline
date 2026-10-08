import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { validateSha } from "./smoke-config.mjs";

const sha = validateSha(process.env.RENDER_GIT_COMMIT);
const output = new URL("../dist/render/", import.meta.url);
// Stage outside dist so copying the built shell cannot recursively copy itself.
const staging = new URL("../.render-output/", import.meta.url);
await rm(output, { recursive: true, force: true });
await rm(staging, { recursive: true, force: true });
await mkdir(staging, { recursive: true });
await writeFile(new URL("../dist/build-info.json", import.meta.url), JSON.stringify({ schemaVersion: 1, sha }) + "\n");
await cp(new URL("../dist/", import.meta.url), new URL("fieldops-offline/", staging), { recursive: true });
await writeFile(new URL("index.html", staging), '<!doctype html><html lang="en"><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=/fieldops-offline/"><title>FieldOps Offline</title><a href="/fieldops-offline/">Open FieldOps Offline</a></html>\n');
await mkdir(output, { recursive: true });
await cp(staging, output, { recursive: true });
await rm(staging, { recursive: true });
