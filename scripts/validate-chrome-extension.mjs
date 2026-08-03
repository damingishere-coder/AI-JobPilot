import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, normalize, relative, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";

const repoRoot = resolve(process.cwd());
const extensionRoot = resolve(repoRoot, process.argv[2] ?? "chrome-extension");
const manifestPath = join(extensionRoot, "manifest.json");

function fail(message) {
  console.error(`::error::${message}`);
  process.exitCode = 1;
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function safeExtensionPath(value) {
  const normalized = normalize(value).replace(/^[/\\]+/, "");
  const absolute = resolve(extensionRoot, normalized);
  const relativePath = relative(extensionRoot, absolute);
  if (relativePath.startsWith(`..${sep}`) || relativePath === "..") {
    fail(`Manifest path escapes chrome-extension/: ${value}`);
    return null;
  }
  return absolute;
}

function addReference(references, value, source) {
  if (typeof value !== "string" || value.trim() === "") return;
  if (value.includes("*")) return;
  references.push({ value, source });
}

assert(existsSync(manifestPath), "chrome-extension/manifest.json is missing");
if (!existsSync(manifestPath)) process.exit(1);

let manifest;
try {
  manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
} catch (error) {
  fail(`manifest.json is not valid JSON: ${error.message}`);
  process.exit(1);
}

assert(manifest.manifest_version === 3, "manifest_version must be 3");
assert(typeof manifest.name === "string" && manifest.name.trim() !== "", "manifest name is required");
assert(/^\d+\.\d+\.\d+(?:\.\d+)?$/.test(manifest.version ?? ""), "manifest version must use numeric dot notation");
assert(Array.isArray(manifest.permissions), "permissions must be an array");
assert(Array.isArray(manifest.host_permissions), "host_permissions must be an array");

const references = [];
addReference(references, manifest.background?.service_worker, "background.service_worker");
addReference(references, manifest.action?.default_popup, "action.default_popup");
addReference(references, manifest.options_page, "options_page");
addReference(references, manifest.options_ui?.page, "options_ui.page");
addReference(references, manifest.devtools_page, "devtools_page");

for (const [size, icon] of Object.entries(manifest.icons ?? {})) {
  addReference(references, icon, `icons.${size}`);
}

for (const [index, script] of (manifest.content_scripts ?? []).entries()) {
  for (const file of script.js ?? []) addReference(references, file, `content_scripts[${index}].js`);
  for (const file of script.css ?? []) addReference(references, file, `content_scripts[${index}].css`);
}

for (const [index, resourceGroup] of (manifest.web_accessible_resources ?? []).entries()) {
  for (const file of resourceGroup.resources ?? []) {
    addReference(references, file, `web_accessible_resources[${index}]`);
  }
}

for (const reference of references) {
  const absolute = safeExtensionPath(reference.value);
  if (!absolute) continue;
  assert(existsSync(absolute), `${reference.source} references missing file: ${reference.value}`);
  if (existsSync(absolute)) {
    assert(statSync(absolute).isFile(), `${reference.source} must reference a file: ${reference.value}`);
  }
}

const javascriptFiles = references
  .map(({ value }) => value)
  .filter((value) => value.endsWith(".js"))
  .filter((value, index, array) => array.indexOf(value) === index);

for (const file of javascriptFiles) {
  const absolute = safeExtensionPath(file);
  if (!absolute || !existsSync(absolute)) continue;
  const result = spawnSync(process.execPath, ["--check", absolute], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    fail(`JavaScript syntax check failed for ${file}\n${result.stderr || result.stdout}`);
  }
}

if (process.exitCode) process.exit(process.exitCode);

console.log(`Chrome extension validation passed.`);
console.log(`Manifest: ${relative(repoRoot, manifestPath)}`);
console.log(`Referenced files checked: ${references.length}`);
console.log(`JavaScript files syntax-checked: ${javascriptFiles.length}`);
