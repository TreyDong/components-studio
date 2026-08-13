import { readFileSync, writeFileSync } from "fs";

const targetVersion = process.env.npm_package_version;
const minAppVersion = "1.7.2";

const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
const versions = JSON.parse(readFileSync("versions.json", "utf8"));

manifest.version = targetVersion;
manifest.minAppVersion = minAppVersion;

writeFileSync("manifest.json", JSON.stringify(manifest, null, "\t"));
versions[targetVersion] = minAppVersion;
writeFileSync("versions.json", JSON.stringify(versions, null, "\t"));
