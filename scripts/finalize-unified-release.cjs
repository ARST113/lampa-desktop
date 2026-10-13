"use strict";
// Finalize the verified ac3.24 unified release. Historical ac3.7 assets remain
// available in their original release; only duplicate downloads are removed here.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const repo = "ARST113/lampa-desktop";
const tag = "v1.6.0-ac3.24";
const base = "https://github.com/" + repo + "/releases/download/" + tag + "/";
const raw = "https://raw.githubusercontent.com/" + repo + "/main/.github/badges/";
if (process.env.GITHUB_REPOSITORY !== repo) {
  throw new Error("This maintenance script is restricted to " + repo);
}
function gh(args) {
  return execFileSync("gh", args, {
    encoding: "utf8", env: process.env, stdio: ["ignore", "pipe", "inherit"],
    maxBuffer: 4 * 1024 * 1024,
  }).trim();
}
function api(endpoint) {
  return JSON.parse(gh(["api", "repos/" + repo + "/" + endpoint]));
}
function assert(condition, message) {
  if (!condition) throw new Error(message);
}
const latest = api("releases/latest");
assert(latest.tag_name === tag, "Refusing to modify a release that is no longer latest");
const release = api("releases/tags/" + tag);
assert(!release.draft && !release.prerelease, "Expected a published stable release");
assert(release.body.includes("<!-- platform-matrix:start -->") &&
       release.body.includes("<!-- platform-matrix:end -->"),
       "Refusing to overwrite unrecognized release notes");

const win = [
  "lampa-x64-1.6.0-ac3.24.exe",
  "lampa-portable-x64-1.6.0-ac3.24.exe",
  "lampa-portable-zip-x64-1.6.0-ac3.24.zip",
];
const meta = ["ac3.yml", "lampa-x64-1.6.0-ac3.24.exe.blockmap"];
const linux = [
  "lampa-x86_64-1.6.0-ac3.8-linux-ac3.rpm",
  "lampa-x86_64-1.6.0-ac3.8-linux-ac3.AppImage",
  "lampa-aarch64-1.6.0-ac3.8-linux-ac3.rpm",
  "lampa-aarch64-1.6.0-ac3.8-linux-ac3.AppImage",
];
const mac = [
  "lampa-universal-1.6.0-ac3.8-macos-ac3.dmg",
  "lampa-universal-1.6.0-ac3.8-macos-ac3.zip",
  "lampa-x64-1.6.0-ac3.8-macos-ac3.dmg",
  "lampa-x64-1.6.0-ac3.8-macos-ac3.zip",
  "lampa-arm64-1.6.0-ac3.8-macos-ac3.dmg",
  "lampa-arm64-1.6.0-ac3.8-macos-ac3.zip",
];
const required = [...win, ...meta, ...linux, ...mac];
const byName = new Map(release.assets.map((a) => [a.name, a]));
for (const name of required) {
  const asset = byName.get(name);
  assert(asset && asset.state === "uploaded" && asset.size > 0,
    "Required verified package missing: " + name);
  assert(/^sha256:[0-9a-f]{64}$/i.test(asset.digest || ""),
    "GitHub did not provide a valid SHA-256 for " + name);
}
const old = [
  "lampa-x86_64-1.6.0-ac3.7-linux-ac3.rpm",
  "lampa-aarch64-1.6.0-ac3.7-linux-ac3.rpm",
  "lampa-universal-1.6.0-ac3.7-macos-ac3.dmg",
  "lampa-universal-1.6.0-ac3.7-macos-ac3.zip",
  "lampa-x64-1.6.0-ac3.7-macos-ac3.dmg",
  "lampa-x64-1.6.0-ac3.7-macos-ac3.zip",
  "lampa-arm64-1.6.0-ac3.7-macos-ac3.dmg",
  "lampa-arm64-1.6.0-ac3.7-macos-ac3.zip",
];
const archive = api("releases/tags/v1.6.0-ac3.7");
const archiveByName = new Map(archive.assets.map((a) => [a.name, a]));
for (const name of old) {
  const historical = archiveByName.get(name);
  assert(historical && historical.state === "uploaded",
    "Cannot prune " + name + ": original archive release is missing its copy");
  const duplicate = byName.get(name);
  if (duplicate) assert(duplicate.digest === historical.digest,
    "Cannot prune " + name + ": historical checksum differs");
}
const expected = new Set([...required, "SHASUMS256.txt"]);
const allowedObsolete = new Set([...old,
  "SHASUMS256-linux-arm64.txt", "SHASUMS256-linux-x64.txt",
  "SHASUMS256-macos-arm64.txt", "SHASUMS256-macos-x64.txt",
  "SHASUMS256-macos-universal.txt"]);
for (const name of byName.keys()) {
  assert(expected.has(name) || allowedObsolete.has(name),
    "Unknown asset requires manual review before cleanup: " + name);
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lampa-release-"));
const checksumPath = path.join(tmp, "SHASUMS256.txt");
fs.writeFileSync(checksumPath,
  required.slice().sort().map((name) =>
    byName.get(name).digest.slice("sha256:".length) + "  " + name
  ).join("\n") + "\n", "utf8");

function button(label, image, filename) {
  return "[![" + label + "](" + raw + image + ")](" + base + filename + ")";
}
function alternate(label, filename) {
  return "[" + label + "](" + base + filename + ")";
}
const matrix = [
  "<!-- platform-matrix:start -->",
  "# Lampa Desktop — скачать для Windows, macOS и Linux",
  "",
  "**Единый стабильный релиз.** Windows — **1.6.0-ac3.24**; macOS и Linux — **1.6.0-ac3.8**. Все три платформы включают исправление сетевого сбоя, связанного с отменой HTTP-запросов и освобождением соединений. Платформенные сборки прошли проверки GitHub Actions.",
  "",
  "### Windows x64 — 1.6.0-ac3.24",
  "",
  button("Windows Installer", "windows-installer-ac3.24.svg", win[0]),
  button("Windows Portable EXE", "windows-portable-exe-ac3.24.svg", win[1]),
  button("Windows Portable ZIP", "windows-portable-zip-ac3.24.svg", win[2]),
  "",
  "- **Установщик EXE:** стандартная установка, автообновление Windows.",
  "- **Portable EXE:** запуск без установки, профиль в папке LampaData.",
  "- **Portable ZIP:** распакуйте и запустите Lampa.exe, без NSIS-распаковки.",
  "",
  "### macOS — 1.6.0-ac3.8",
  "",
  button("macOS Universal", "macos-universal-ac3.8.svg", mac[0]) + " · " + alternate("ZIP для Universal", mac[1]),
  "",
  button("macOS Intel", "macos-intel-ac3.8.svg", mac[2]) + " · " + alternate("ZIP для Intel", mac[3]),
  "",
  button("macOS Apple Silicon", "macos-arm64-ac3.8.svg", mac[4]) + " · " + alternate("ZIP для Apple Silicon", mac[5]),
  "",
  "**DMG** — откройте образ и перенесите Lampa.app в «Программы». **ZIP** — архив того же приложения. Universal подходит для Intel и Apple Silicon. Требуется macOS 13 Ventura или новее; сборки не нотарифицированы Apple.",
  "",
  "### Linux — 1.6.0-ac3.8",
  "",
  button("Linux x86_64 RPM", "linux-x64-ac3.8.svg", linux[0]) + " · " + alternate("AppImage для x86_64", linux[1]),
  "",
  button("Linux ARM64 RPM", "linux-arm64-ac3.8.svg", linux[2]) + " · " + alternate("AppImage для ARM64", linux[3]),
  "",
  "**RPM** — для совместимых дистрибутивов. **AppImage** — автономный файл, которому требуется разрешение на запуск. Архитектуры: x86_64 и ARM64; DEB и 32-битных пакетов нет.",
  "",
  alternate("Единые контрольные суммы SHA-256", "SHASUMS256.txt") +
    " · [Исходники Electron с AC3/EAC3](https://github.com/ARST113/electron)",
  "",
  "<!-- platform-matrix:end -->",
].join("\n");
const existing = release.body.replace(
  /<!-- platform-matrix:start -->[\s\S]*?<!-- platform-matrix:end -->\s*/, ""
).trim();
const releaseNotes = matrix + "\n\n" + existing + "\n";
assert(!releaseNotes.includes("ac3.7"),
  "Unexpected obsolete platform version in release notes");
const notesPath = path.join(tmp, "release-notes.md");
fs.writeFileSync(notesPath, releaseNotes, "utf8");

// Update discoverability before pruning; all links were validated above.
gh(["release", "edit", tag, "--repo", repo,
  "--title", "Lampa Desktop 1.6.0-ac3.24 — Windows / macOS / Linux",
  "--notes-file", notesPath, "--latest"]);

for (const name of allowedObsolete) {
  const asset = byName.get(name);
  if (!asset) continue;
  gh(["api", "-X", "DELETE", "repos/" + repo + "/releases/assets/" + asset.id]);
  console.log("Removed obsolete duplicate:", name);
}
gh(["release", "upload", tag, checksumPath, "--clobber", "--repo", repo]);
const result = api("releases/tags/" + tag);
const finalNames = new Set(result.assets.map((a) => a.name));
assert(finalNames.size === expected.size && result.assets.length === expected.size,
  "Unexpected final asset count: " + result.assets.length);
for (const name of expected) assert(finalNames.has(name), "Missing final file: " + name);
assert(!result.body.includes("ac3.7") && result.body.includes("ac3.8"),
  "Release description was not updated");
const summary = "Unified " + tag + ": " + result.assets.length +
  " assets (Windows ac3.24, Linux/macOS ac3.8). Historical ac3.7 " +
  "duplicates removed; consolidated checksums published.";
console.log(summary);
if (process.env.GITHUB_STEP_SUMMARY) {
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary + "\n");
}
