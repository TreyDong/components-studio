import esbuild from "esbuild";
import process from "process";
import builtins from "builtin-modules";
import { readFile, writeFile } from "node:fs/promises";

const prod = process.argv[2] === "production";

/**
 * 产物 styles.css = 主样式 + 内置组件目录样式（按固定顺序拼接）。
 * Obsidian 只加载插件根目录的 styles.css；组件样式的 Locality 由
 * 构建期合并保留，不依赖运行时 CSS 注入。
 */
async function copyStyles() {
  const { readdir, stat } = await import("node:fs/promises");
  const widgetDirs = (await readdir("src/widgets", { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const parts = [
    "src/styles.css",
    "src/preview/dashboard-preview.css",
    ...widgetDirs.map((name) => `src/widgets/${name}/styles.css`),
  ];
  try {
    const chunks = [];
    for (const file of parts) {
      try {
        const st = await stat(file);
        if (st.isFile()) chunks.push(await readFile(file, "utf8"));
      } catch {
        // 组件目录可以没有 styles.css；跳过。
      }
    }
    await writeFile("styles.css", chunks.join("\n\n"), "utf8");
  } catch (err) {
    console.error("styles.css 合并失败:", err);
  }
}

const alias = {
  "@ocs/contracts": "./src/contracts/index.ts",
  "@ocs/contracts/common": "./src/contracts/common.ts",
  "@ocs/contracts/document": "./src/contracts/document.ts",
  "@ocs/contracts/query": "./src/contracts/query.ts",
};

const context = await esbuild.context({
  entryPoints: ["src/plugin/main.ts"],
  bundle: true,
  alias,
  external: [
    "obsidian",
    "electron",
    "@codemirror/state",
    "@codemirror/view",
    "@codemirror/commands",
    "@codemirror/language",
    "@codemirror/lang-markdown",
    "@lezer/common",
    "@lezer/highlight",
    "@lezer/markdown",
    ...builtins,
  ],
  format: "cjs",
  target: "es2021",
  logLevel: "info",
  sourcemap: prod ? false : "inline",
  treeShaking: true,
  outfile: "main.js",
  minify: prod,
});

if (prod) {
  await context.rebuild();
  await copyStyles();
  process.exit(0);
} else {
  await copyStyles();
  await context.watch();
}
