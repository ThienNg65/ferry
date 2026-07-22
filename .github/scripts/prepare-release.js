const fs = require("fs");
const path = require("path");

// Resolve files relative to this script file
const repoRoot = path.join(__dirname, "..", "..");
const pkgPath = path.join(repoRoot, "package.json");
const changelogPath = path.join(repoRoot, "CHANGELOG.md");

const version = require(pkgPath).version;
const today = new Date().toISOString().slice(0, 10);

let text = fs.readFileSync(changelogPath, "utf8");

// Use multiline flag so ^ matches the start of a line
const newText = text.replace(/^## Unreleased/m, `## ${version} - ${today}`);

if (newText === text) {
  console.error("prepare-release: could not find '## Unreleased' in CHANGELOG.md");
  process.exit(1);
}

fs.writeFileSync(changelogPath, newText, "utf8");
console.log(`Updated CHANGELOG.md to ${version} - ${today}`);
