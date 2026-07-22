const fs = require("fs");

const version = require("../package.json").version;

const today = new Date().toISOString().slice(0,10);

let text = fs.readFileSync("CHANGELOG.md","utf8");

text = text.replace(
    /^## Unreleased/,
    `## ${version} - ${today}`
);

fs.writeFileSync("CHANGELOG.md", text);