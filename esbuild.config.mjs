import esbuild from "esbuild";
import process from "process";
import builtins from "builtin-modules";
import { copyFile } from "node:fs/promises";

const prod = process.argv[2] === "production";

async function copyStyles() {
  try {
    await copyFile("src/styles.css", "styles.css");
  } catch (err) {
    console.error("styles.css 复制失败:", err);
  }
}

const alias = {
  "@ocs/contracts": "./src/contracts/index.ts",
  "@ocs/contracts/common": "./src/contracts/common.ts",
  "@ocs/contracts/document": "./src/contracts/document.ts",
  "@ocs/contracts/query": "./src/contracts/query.ts",
};

const context = await esbuild.context({
  entryPoints: ["main.ts"],
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
