import { readFileSync, writeFileSync } from "fs";

const targetVersion = process.env.npm_package_version;

// 从 manifest.json 读取 minAppVersion，版本号升到目标版本
const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
const { minAppVersion } = manifest;
manifest.version = targetVersion;
writeFileSync("manifest.json", JSON.stringify(manifest, null, "\t"));

// versions.json 记录 targetVersion → minAppVersion（已存在则不重复写入）
const versions = JSON.parse(readFileSync("versions.json", "utf8"));
if (!(targetVersion in versions)) {
	versions[targetVersion] = minAppVersion;
	writeFileSync("versions.json", JSON.stringify(versions, null, "\t"));
}
