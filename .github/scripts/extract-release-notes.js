const fs = require("fs");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const changelogPath = path.join(repoRoot, "CHANGELOG.md");
const outPath = path.join(repoRoot, "RELEASE_NOTES.md");

const changelog = fs.readFileSync(changelogPath, "utf8");

// The changelog has just been updated to have `## x.y.z - date` at the top.
// We need to extract this section up to the next `## ` heading.

// Match from the first `## ` up to (but not including) the second `## ` followed by a version number
const match = changelog.match(/^## [^\n]+[\s\S]*?(?=^## \d+\.\d+\.\d+)/m);

if (match) {
    fs.writeFileSync(outPath, match[0].trim(), "utf8");
    console.log("Extracted release notes.");
} else {
    // If there's no second `## ` (e.g., first release), just take to the end of the file
    const fallbackMatch = changelog.match(/^## [^\n]+[\s\S]*/m);
    if (fallbackMatch) {
        fs.writeFileSync(outPath, fallbackMatch[0].trim(), "utf8");
        console.log("Extracted release notes (fallback).");
    } else {
        console.error("Could not find release notes section in CHANGELOG.md");
        process.exit(1);
    }
}
