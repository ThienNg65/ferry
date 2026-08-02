const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// Resolve files relative to this script file
const repoRoot = path.join(__dirname, "..", "..");
const distDir = path.join(repoRoot, "dist");
const version = require(path.join(repoRoot, "package.json")).version;

// SignPath overwrites the installer in place (output-artifact-directory: dist),
// same filename as the unsigned build produced — find it rather than assuming
// exact casing/path.
const exeName = fs.readdirSync(distDir).find((f) => /^Ferry-Setup-.*\.exe$/.test(f));
if (!exeName) {
  console.error("regenerate-update-yml: no Ferry-Setup-*.exe found in dist/");
  process.exit(1);
}
const exePath = path.join(distDir, exeName);

const sha512 = crypto.createHash("sha512").update(fs.readFileSync(exePath)).digest("base64");
const size = fs.statSync(exePath).size;
const releaseDate = new Date().toISOString();

// Signing changes the exe's bytes, so the pre-signing dist/latest.yml (built
// from the unsigned exe) and dist/*.blockmap (built from the unsigned exe's
// block layout) are both stale. latest.yml is rewritten below with the signed
// file's real hash/size; the blockmap is deleted rather than rebuilt — a
// stale one would otherwise fail differential-update hash validation and
// silently fall back to a full download anyway, so there's nothing lost by
// not shipping one for a signed release.
const latestYml = `version: ${version}
files:
  - url: ${exeName}
    sha512: ${sha512}
    size: ${size}
path: ${exeName}
sha512: ${sha512}
releaseDate: '${releaseDate}'
`;
fs.writeFileSync(path.join(distDir, "latest.yml"), latestYml, "utf8");

for (const f of fs.readdirSync(distDir)) {
  if (f.endsWith(".blockmap")) {
    fs.unlinkSync(path.join(distDir, f));
  }
}

console.log(`Regenerated dist/latest.yml for signed ${exeName} (sha512/size updated, stale blockmap removed).`);
