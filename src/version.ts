import { readFileSync } from "node:fs";

// package.json sits one level above both src/ and dist/, so this resolves in dev, tests and the published package.
const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { name: string; version: string };

export const NAME = pkg.name;
export const VERSION = pkg.version;
