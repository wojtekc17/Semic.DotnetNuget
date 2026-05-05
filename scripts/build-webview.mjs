import { copyFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outputDirectory = resolve(root, "dist", "webview", "assets");

await mkdir(outputDirectory, { recursive: true });
await copyFile(resolve(root, "webview", "static", "App.js"), resolve(outputDirectory, "App.js"));
await copyFile(resolve(root, "webview", "src", "Styles", "App.css"), resolve(outputDirectory, "App.css"));

if (process.argv.includes("--watch")) {
  console.log("Static webview assets built. Re-run build:webview after changes.");
}
