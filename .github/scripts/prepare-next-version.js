const fs = require("fs");

const changelog = fs.readFileSync("CHANGELOG.md","utf8");

const header = `# Changelog

All notable changes to Ferry are documented in this file, in Keep a Changelog style.

## Unreleased

### Added

### Changed

### Fixed

`;

const body = changelog.replace(
    /^# Changelog[\s\S]*?(?=## )/,
    ""
);

fs.writeFileSync(
    "CHANGELOG.md",
    header + body
);