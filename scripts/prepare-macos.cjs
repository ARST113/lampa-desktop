const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const pins = require("../build/electron-runtime-macos.json");
const pkg = require("../package.json");

const arch = process.argv[2];
const pin = pins[arch];
assert.ok(pin, "Choose x64, arm64 or universal");
assert.equal(pkg.devDependencies.electron, "44.4.4");
const cache = path.resolve(".cache");
const download = path.join(cache, `macos-${arch}-download`);
const runtime = path.join(cache, `electron-macos-${arch}`);
const legacy = path.join(cache, `macos-${arch}-subtitle-source`);
fs.mkdirSync(download, { recursive: true });

function run(command, args) {
  execFileSync(command, args, { stdio: "inherit" });
}

async function digest(file) {
  const hash = createHash("sha256");
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

async function prepare() {
  run("gh", [
    "release",
    "download",
    pin.tag,
    "--repo",
    "ARST113/electron",
    "--dir",
    download,
    "--pattern",
    pin.runtime,
    "--pattern",
    pin.subtitleSource,
  ]);
  for (const [file, hash] of [
    [pin.runtime, pin.runtimeSha256],
    [pin.subtitleSource, pin.subtitleSourceSha256],
  ]) {
    assert.equal(await digest(path.join(download, file)), hash, file);
    console.log(`Verified SHA-256: ${file}`);
  }
  run("unzip", ["-q", path.join(download, pin.runtime), "-d", runtime]);
  assert.equal(
    fs.readFileSync(path.join(runtime, "version"), "utf8").trim(),
    "44.4.4",
  );
  run("unzip", [
    "-q",
    path.join(download, pin.subtitleSource),
    "Lampa.app/Contents/Resources/subtitle-tools/*",
    "-d",
    legacy,
  ]);
  const subtitleTools = path.join(cache, "subtitle-tools");
  const sourceTools = path.join(
    legacy,
    "Lampa.app/Contents/Resources/subtitle-tools",
  );
  // Retain any license and README notices from the verified previous bundle.
  fs.cpSync(sourceTools, subtitleTools, { recursive: true });
  for (const tool of ["ffmpeg", "ffprobe"]) {
    const source = path.join(sourceTools, tool);
    assert.ok(
      fs.existsSync(source),
      `Previously verified bundle is missing ${tool}`,
    );
    fs.chmodSync(path.join(subtitleTools, tool), 0o755);
  }
  run("xattr", ["-cr", runtime, subtitleTools]);
  const builderArch = arch === "arm64" ? "arm64" : "x64";
  // The universal runtime and subtitle tools already contain both native slices.
  // An x64 packaging pass copies them without rebuilding or merging Chromium.
  const config = {
    ...pkg.build,
    electronDist: runtime,
    electronVersion: "44.4.4",
    extraResources: [
      {
        from: ".cache/subtitle-tools",
        to: "subtitle-tools",
        filter: ["**/*"],
      },
    ],
    artifactName: `lampa-${arch}-${pkg.version}-macos-ac3.\${ext}`,
    mac: {
      ...pkg.build.mac,
      identity: null,
      target: [
        { target: "dmg", arch: [builderArch] },
        { target: "zip", arch: [builderArch] },
      ],
    },
  };
  fs.writeFileSync(
    path.join(cache, "electron-builder-macos.json"),
    JSON.stringify(config, null, 2),
  );
}

prepare().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
