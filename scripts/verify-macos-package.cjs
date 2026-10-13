const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const asar = require("@electron/asar");
const pkg = require("../package.json");
const pins = require("../build/electron-runtime-macos.json");

const [mode, arch, inputApp] = process.argv.slice(2);
assert.ok(["sign", "verify"].includes(mode));
assert.ok(pins[arch]);
const app = path.resolve(
  inputApp || `dist/${arch === "arm64" ? "mac-arm64" : "mac"}/Lampa.app`,
);
const relativeFramework =
  "Contents/Frameworks/Electron Framework.framework/Versions/A/Electron Framework";
const framework = path.join(app, relativeFramework);
const archive = path.join(app, "Contents/Resources/app.asar");
const sourceFramework = path.resolve(
  `.cache/electron-macos-${arch}/Electron.app`,
  relativeFramework,
);
const provenancePath = path.resolve(`.cache/macos-${arch}-provenance.json`);
const expectedSlices =
  arch === "universal"
    ? ["x86_64", "arm64"]
    : [arch === "x64" ? "x86_64" : "arm64"];
const bundled = [
  relativeFramework,
  "Contents/Resources/app.asar",
  "Contents/Resources/subtitle-tools/ffmpeg",
  "Contents/Resources/subtitle-tools/ffprobe",
];

function digest(file) {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function verifyApplication() {
  assert.equal(
    JSON.parse(asar.extractFile(archive, "package.json").toString()).version,
    pkg.version,
  );
  for (const file of [
    "electronNetFetch.js",
    "playerOptionsInterceptor.js",
    "subtitleStream.js",
    "torrServerManager.js",
    "ipcHandlers/cloudHandlers.js",
  ]) {
    const relative = `src/modules/${file}`;
    assert.deepEqual(
      asar.extractFile(archive, relative),
      fs.readFileSync(relative),
      `Packaged ${file} differs from the checked-out fix`,
    );
  }
  for (const relative of [
    "Contents/MacOS/Lampa",
    relativeFramework,
    "Contents/Resources/subtitle-tools/ffmpeg",
    "Contents/Resources/subtitle-tools/ffprobe",
  ]) {
    const slices = execFileSync("lipo", ["-archs", path.join(app, relative)], {
      encoding: "utf8",
    })
      .trim()
      .split(/\s+/)
      .sort();
    assert.deepEqual(slices, [...expectedSlices].sort(), relative);
  }
}

verifyApplication();
if (mode === "sign") {
  assert.equal(
    digest(framework),
    digest(sourceFramework),
    "Packaging replaced the custom Electron framework",
  );
  for (const tool of ["ffmpeg", "ffprobe"]) {
    assert.equal(
      digest(path.join(app, "Contents/Resources/subtitle-tools", tool)),
      digest(path.resolve(".cache/subtitle-tools", tool)),
      `Packaging changed ${tool}`,
    );
  }
  const sourceSha256 = digest(sourceFramework);
  // Sign the bundle BEFORE electron-builder creates its DMG and ZIP.
  execFileSync("codesign", ["--force", "--deep", "--sign", "-", app], {
    stdio: "inherit",
  });
  fs.writeFileSync(
    provenancePath,
    JSON.stringify(
      {
        version: pkg.version,
        arch,
        runtime: pins[arch],
        sourceFrameworkSha256: sourceSha256,
        signedFiles: Object.fromEntries(
          bundled.map((relative) => [
            relative,
            digest(path.join(app, relative)),
          ]),
        ),
      },
      null,
      2,
    ),
  );
}
const provenance = JSON.parse(fs.readFileSync(provenancePath, "utf8"));
assert.equal(provenance.version, pkg.version);
assert.equal(provenance.sourceFrameworkSha256, digest(sourceFramework));
for (const [relative, hash] of Object.entries(provenance.signedFiles)) {
  assert.equal(
    digest(path.join(app, relative)),
    hash,
    `Signed bundle changed: ${relative}`,
  );
}
execFileSync(
  "codesign",
  ["--verify", "--deep", "--strict", "--verbose=2", app],
  { stdio: "inherit" },
);
console.log(
  `Verified Lampa ${pkg.version} (${arch}): packaged cancellation fix, custom runtime, subtitle tools and signature`,
);
