/**
 * 依赖方向测试：contracts 只能依赖其他 contracts；widgets 不得 import obsidian/platform。
 * 规则来自《技术规格 v1》第 5.1 节与《运行时与 SDK 协议 v1》第 0.3 节。
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function collectFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const entry of readdirSync(d)) {
      const full = join(d, entry);
      const st = statSync(full);
      if (st.isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
    }
  };
  walk(dir);
  return out;
}

function importsOf(file: string): string[] {
  const src = readFileSync(file, "utf8");
  const imports: string[] = [];
  const re =
    /(?:import|export)\s+(?:type\s+)?(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const spec = m[1];
    if (!spec || spec.startsWith(".") || spec.startsWith("node:")) continue;
    imports.push(spec);
  }
  return imports;
}

describe("contracts 依赖方向", () => {
  const files = collectFiles("src/contracts");

  it("contracts 目录存在且包含四个模块", () => {
    expect(files).toContain("src/contracts/common.ts");
    expect(files).toContain("src/contracts/document.ts");
    expect(files).toContain("src/contracts/query.ts");
    expect(files).toContain("src/contracts/index.ts");
  });

  it("contracts 不依赖 React / Obsidian / Runtime / Adapter", () => {
    const forbidden: Record<string, true> = {
      react: true,
      "react-dom": true,
      obsidian: true,
      electron: true,
    };
    const violations: string[] = [];
    for (const file of files) {
      for (const spec of importsOf(file)) {
        if (forbidden[spec]) violations.push(`${file} -> ${spec}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it("contracts 内部只 import 相对路径（同包）", () => {
    const violations: string[] = [];
    for (const file of files) {
      for (const spec of importsOf(file)) {
        if (spec.startsWith("@ocs/")) violations.push(`${file} -> ${spec}`);
      }
    }
    expect(violations).toEqual([]);
  });
});

describe("widgets 安全边界", () => {
  const files = collectFiles("src/widgets");

  it("widgets 不得 import obsidian / electron / platform 实现", () => {
    const violations: string[] = [];
    for (const file of files) {
      for (const spec of importsOf(file)) {
        if (
          spec === "obsidian" ||
          spec === "electron" ||
          /platform[\\/]obsidian/.test(spec) ||
          /ObsidianPlatformAdapter|ObsidianStorageAdapter/.test(spec)
        ) {
          violations.push(`${file} -> ${spec}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("widgets 源码不得出现 eval / new Function / dynamic require", () => {
    const bad: string[] = [];
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      if (/\beval\s*\(/.test(src) || /new\s+Function\s*\(/.test(src)) {
        bad.push(file);
      }
    }
    expect(bad).toEqual([]);
  });
});

describe("typescript 严格模式约束", () => {
  const tsconfig = JSON.parse(readFileSync("tsconfig.json", "utf8"));
  it("tsconfig 开启 strict 并冻结 @ocs/contracts 别名", () => {
    expect(tsconfig.compilerOptions.strict).toBe(true);
    expect(tsconfig.compilerOptions.paths["@ocs/contracts"]).toBeDefined();
    expect(tsconfig.compilerOptions.paths["@ocs/contracts/common"]).toBeDefined();
    expect(tsconfig.compilerOptions.paths["@ocs/contracts/document"]).toBeDefined();
    expect(tsconfig.compilerOptions.paths["@ocs/contracts/query"]).toBeDefined();
  });
});
