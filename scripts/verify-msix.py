"""Validate Ferry's finished Store MSIX and record the hash of the upload file."""

import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import struct
import xml.etree.ElementTree as ET
import zipfile


ROOT = Path(__file__).resolve().parents[1]
MANIFEST_NS = "{http://schemas.microsoft.com/appx/manifest/foundation/windows10}"
VISUAL_NS = "{http://schemas.microsoft.com/appx/manifest/uap/windows10}"
BLOCK_MAP_NS = "{http://schemas.microsoft.com/appx/2010/blockmap}"
BLOCK_SIZE = 64 * 1024


def require(condition, message):
    if not condition:
        raise ValueError(message)


def read_manifest(archive, version):
    manifest = ET.fromstring(archive.read("AppxManifest.xml"))
    identity = manifest.find(f"{MANIFEST_NS}Identity")
    require(identity is not None, "AppxManifest.xml is missing Package/Identity")
    expected = {
        "Name": "ThienNg65.FerryFileClient",
        "Publisher": "CN=7526EFCF-38D0-48DA-84C1-1C01E8EE1282",
        "Version": version,
        "ProcessorArchitecture": "x64",
    }
    for attribute, value in expected.items():
        actual = identity.get(attribute)
        require(actual == value, f"Manifest Identity/{attribute}: expected {value!r}, got {actual!r}")

    application = manifest.find(f"{MANIFEST_NS}Applications/{MANIFEST_NS}Application")
    require(application is not None, "AppxManifest.xml is missing Package/Applications/Application")
    require(application.get("Executable") == "ferry-win_x64.exe", "Unexpected application executable")

    logo = manifest.findtext(f"{MANIFEST_NS}Properties/{MANIFEST_NS}Logo")
    visual = application.find(f"{VISUAL_NS}VisualElements")
    require(visual is not None, "AppxManifest.xml is missing VisualElements")
    logos = {
        "StoreLogo": (logo, 50),
        "Square44x44Logo": (visual.get("Square44x44Logo"), 44),
        "Square150x150Logo": (visual.get("Square150x150Logo"), 150),
    }
    return expected, logos


def verify_block_map(archive, payload_files):
    block_map = ET.fromstring(archive.read("AppxBlockMap.xml"))
    require(block_map.tag == f"{BLOCK_MAP_NS}BlockMap", "Invalid MSIX block map namespace")
    require(
        block_map.get("HashMethod") == "http://www.w3.org/2001/04/xmlenc#sha256",
        "Expected a SHA-256 MSIX block map",
    )
    verified = set()
    for file in block_map.findall(f"{BLOCK_MAP_NS}File"):
        name = file.attrib["Name"].replace("\\", "/")
        require(name not in verified, f"Duplicate block map entry: {name}")
        with archive.open(name) as payload:
            require(int(file.attrib["Size"]) == archive.getinfo(name).file_size, f"Size mismatch: {name}")
            for index, block in enumerate(file.findall(f"{BLOCK_MAP_NS}Block"), start=1):
                chunk = payload.read(BLOCK_SIZE)
                expected = base64.b64encode(hashlib.sha256(chunk).digest()).decode("ascii")
                require(chunk and block.get("Hash") == expected, f"Invalid SHA-256 for {name}, block {index}")
            require(not payload.read(1), f"Block map does not cover all bytes of {name}")
        verified.add(name)
    missing = payload_files - verified
    require(not missing, f"Package files missing from block map: {', '.join(sorted(missing))}")


def verify_package(package, version):
    with zipfile.ZipFile(package) as archive:
        names = archive.namelist()
        require(len(names) == len(set(names)), "MSIX contains duplicate ZIP entries")
        bad_file = archive.testzip()
        require(bad_file is None, f"MSIX archive CRC check failed: {bad_file}")
        archive.getinfo("[Content_Types].xml")
        require("AppxSignature.p7x" not in names, "Expected the unsigned Store submission package")
        identity, logos = read_manifest(archive, version)
        required_files = {
            "AppxManifest.xml",
            "ferry-win_x64.exe",
            "resources.neu",
            "extensions/js.ferry.sidecar/index.cjs",
            "extensions/js.ferry.sidecar/node.exe",
        }
        for label, (path, size) in logos.items():
            require(path, f"Missing manifest path for {label}")
            name = path.replace("\\", "/")
            with archive.open(name) as logo:
                header = logo.read(24)
            require(
                len(header) == 24
                and header[:16] == b"\x89PNG\r\n\x1a\n\x00\x00\x00\x0dIHDR"
                and struct.unpack(">II", header[16:]) == (size, size),
                f"{label}: expected a {size}x{size} PNG at {name}",
            )
            required_files.add(name)
        for name in required_files:
            require(archive.getinfo(name).file_size > 0, f"Empty required package entry: {name}")
        verify_block_map(archive, set(names) - {"[Content_Types].xml", "AppxBlockMap.xml"})
        return identity


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dist", type=Path, default=ROOT / "dist")
    parser.add_argument("--report", type=Path, required=True)
    args = parser.parse_args()

    try:
        package_version = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))["version"]
        version = os.environ.get("FERRY_MSIX_VERSION", "").strip() or f"{package_version.split('-', 1)[0]}.0"
        packages = list(args.dist.glob("FerryFileClient-*.msix"))
        expected_name = f"FerryFileClient-{version}-x64.msix"
        require(
            len(packages) == 1 and packages[0].name == expected_name,
            f"Expected exactly one MSIX named {expected_name}, found {[package.name for package in packages]}",
        )
        package = packages[0]
        identity = verify_package(package, version)
        with package.open("rb") as upload:
            sha256 = hashlib.file_digest(upload, "sha256").hexdigest()
        report = {
            "file": package.name,
            "bytes": package.stat().st_size,
            "sha256": sha256,
            "identity": identity,
            "commit": os.environ.get("GITHUB_SHA"),
        }
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
        print(f"Verified {report['file']} ({report['bytes']:,} bytes), SHA-256 {sha256}")
    except (OSError, KeyError, ValueError, ET.ParseError, zipfile.BadZipFile) as error:
        parser.exit(1, f"MSIX verification failed: {error}\n")


if __name__ == "__main__":
    main()
