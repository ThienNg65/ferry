const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

/** Finds the single `Ferry-Setup-*.exe` in `distDir` and verifies it matches `version`. */
function findUniqueInstaller(distDir, version) {
  if (!fs.existsSync(distDir)) {
    throw new Error(`regenerate-update-yml: dist directory does not exist: ${distDir}`);
  }
  const matches = fs
    .readdirSync(distDir)
    .filter((f) => /^Ferry-Setup-.*\.exe$/i.test(f));
  if (matches.length === 0) {
    throw new Error("regenerate-update-yml: no Ferry-Setup-*.exe found in dist/");
  }
  if (matches.length > 1) {
    throw new Error(
      `regenerate-update-yml: expected exactly 1 Ferry-Setup-*.exe in dist/, found ${matches.length} (${matches.join(", ")})`
    );
  }
  const exeName = matches[0];
  const expectedName = `Ferry-Setup-${version}.exe`;
  if (exeName !== expectedName) {
    throw new Error(
      `regenerate-update-yml: expected ${expectedName} for version ${version}, found ${exeName}`
    );
  }
  return exeName;
}

/** Builds standard electron-builder/neutralino `latest.yml` content for an installer. */
function buildLatestYml({ version, exeName, sha512, size, releaseDate }) {
  return `version: ${version}
files:
  - url: ${exeName}
    sha512: ${sha512}
    size: ${size}
path: ${exeName}
sha512: ${sha512}
releaseDate: '${releaseDate}'
`;
}

/**
 * Recomputes SHA-512/size for the signed `Ferry-Setup-<version>.exe` in `distDir`,
 * deletes any stale `*.blockmap` files, and writes `latest.yml`.
 */
function regenerateUpdateYml({ distDir, version, releaseDate = new Date().toISOString() }) {
  const exeName = findUniqueInstaller(distDir, version);
  const exePath = path.join(distDir, exeName);

  // Signing changes the exe's bytes, so pre-signing latest.yml and any *.blockmap
  // are stale; remove blockmaps so clients perform a verified full download.
  for (const entry of fs.readdirSync(distDir)) {
    if (/\.blockmap$/i.test(entry)) {
      fs.rmSync(path.join(distDir, entry), { force: true });
    }
  }

  const exeBuf = fs.readFileSync(exePath);
  const sha512 = crypto.createHash("sha512").update(exeBuf).digest("base64");
  const size = exeBuf.length;
  const latestYml = buildLatestYml({ version, exeName, sha512, size, releaseDate });
  fs.writeFileSync(path.join(distDir, "latest.yml"), latestYml, "utf8");
  return { exeName, sha512, size, latestYml };
}

/** Parses and validates `dist/latest.yml` against the installer bytes on disk. */
function verifyUpdateYml({ distDir, expectedVersion }) {
  const exeName = findUniqueInstaller(distDir, expectedVersion);
  const exePath = path.join(distDir, exeName);
  const manifestPath = path.join(distDir, "latest.yml");
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`verify-update-yml: missing ${manifestPath}`);
  }
  const blockmaps = fs.readdirSync(distDir).filter((f) => /\.blockmap$/i.test(f));
  if (blockmaps.length > 0) {
    throw new Error(`verify-update-yml: unexpected stale blockmap file(s): ${blockmaps.join(", ")}`);
  }

  const yamlText = fs.readFileSync(manifestPath, "utf8");
  const versionMatch = yamlText.match(/^version:\s*(.+)$/m);
  const pathMatch = yamlText.match(/^path:\s*(.+)$/m);
  const topShaMatch = yamlText.match(/^sha512:\s*(.+)$/m);
  const fileUrlMatch = yamlText.match(/^\s*-\s*url:\s*(.+)$/m);
  const fileShaMatch = yamlText.match(/^\s+sha512:\s*(.+)$/m);
  const fileSizeMatch = yamlText.match(/^\s+size:\s*(\d+)\s*$/m);

  const unquote = (v) => (v ? v.trim().replace(/^['"]|['"]$/g, "") : "");
  const manifestVersion = unquote(versionMatch?.[1]);
  const manifestPathField = unquote(pathMatch?.[1]);
  const manifestTopSha = unquote(topShaMatch?.[1]);
  const manifestFileUrl = unquote(fileUrlMatch?.[1]);
  const manifestFileSha = unquote(fileShaMatch?.[1]);
  const manifestFileSize = fileSizeMatch ? Number(fileSizeMatch[1]) : NaN;

  const exeBuf = fs.readFileSync(exePath);
  const actualSha512 = crypto.createHash("sha512").update(exeBuf).digest("base64");
  const actualSize = exeBuf.length;

  if (manifestVersion !== expectedVersion) {
    throw new Error(`verify-update-yml: latest.yml version "${manifestVersion}" !== expected "${expectedVersion}"`);
  }
  if (manifestPathField !== exeName || manifestFileUrl !== exeName) {
    throw new Error(
      `verify-update-yml: latest.yml path/url ("${manifestPathField}" / "${manifestFileUrl}") !== "${exeName}"`
    );
  }
  if (manifestTopSha !== actualSha512 || manifestFileSha !== actualSha512) {
    throw new Error(`verify-update-yml: latest.yml sha512 does not match ${exeName} on disk`);
  }
  if (manifestFileSize !== actualSize) {
    throw new Error(`verify-update-yml: latest.yml size (${manifestFileSize}) !== ${exeName} size (${actualSize})`);
  }
  return { exeName, sha512: actualSha512, size: actualSize };
}

function main(argv = process.argv.slice(2)) {
  const repoRoot = path.join(__dirname, "..", "..");
  const distDir = path.join(repoRoot, "dist");
  const pkgVersion = require(path.join(repoRoot, "package.json")).version;

  const verifyMode = argv.includes("--verify");
  const versionFlagIdx = argv.indexOf("--version");
  const flagVersion = versionFlagIdx !== -1 ? argv[versionFlagIdx + 1] : undefined;
  const expectedVersion = flagVersion || pkgVersion;

  if (flagVersion && flagVersion !== pkgVersion) {
    throw new Error(
      `regenerate-update-yml: expected version (${flagVersion}) !== package.json version (${pkgVersion})`
    );
  }

  if (verifyMode) {
    const info = verifyUpdateYml({ distDir, expectedVersion });
    console.log(
      `Verified dist/latest.yml for ${info.exeName} (version=${expectedVersion}, size=${info.size}, sha512=${info.sha512.slice(0, 12)}...).`
    );
    return;
  }

  const info = regenerateUpdateYml({ distDir, version: expectedVersion });
  console.log(
    `Regenerated dist/latest.yml for signed ${info.exeName} (size=${info.size}, sha512 updated).`
  );
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

module.exports = {
  findUniqueInstaller,
  buildLatestYml,
  regenerateUpdateYml,
  verifyUpdateYml
};
