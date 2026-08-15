import esbuild from "esbuild";
import { mkdirSync, writeFileSync, copyFileSync } from "node:fs";

const outdir = "dist-preview";
const buildId = Date.now();

const context = await esbuild.context({
  entryPoints: ["src/preview/main.tsx"],
  bundle: true,
  format: "iife",
  target: "es2021",
  jsx: "automatic",
  outfile: `${outdir}/preview.js`,
  logLevel: "info",
  sourcemap: false,
});

await context.rebuild();
await context.dispose();

mkdirSync(outdir, { recursive: true });
// 预览必须显式携带与 Obsidian 插件一致的样式产物。此前目录中即使
// 存在 styles.css，index.html 也没有引用它，静态预览会完全无样式。
copyFileSync("styles.css", `${outdir}/styles.css`);
copyFileSync("src/preview/dashboard-preview.css", `${outdir}/dashboard-preview.css`);
copyFileSync("src/preview/project-dashboard.components", `${outdir}/project-dashboard.components`);
const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Components Studio 预览 · 项目管理首页</title>
<link rel="stylesheet" href="./styles.css?v=${buildId}" />
<link rel="stylesheet" href="./dashboard-preview.css?v=${buildId}" />
<style>
  :root {
    --ocs-background: #f6f7f9;
    --ocs-surface: #ffffff;
    --ocs-surface-hover: #eef0f3;
    --ocs-text: #1e2228;
    --ocs-text-muted: #6b7280;
    --ocs-border: #d8dce2;
    --ocs-accent: #4d96ff;
    --ocs-danger: #e5484d;
    --ocs-success: #30a46c;
    --ocs-warning: #ffb224;
    --radius-m: 8px;
    --size-4-1: 4px;
    --size-4-2: 8px;
  }
  body {
    margin: 0;
    padding: 24px;
    background: var(--ocs-background);
    font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
    color: var(--ocs-text);
  }
  #app {
    max-width: 1100px;
    margin: 0 auto;
  }
  .ocs-md-body h1, .ocs-md-body h2, .ocs-md-body h3 { margin: 4px 0 8px; }
  .ocs-md-body h3 { font-size: 15px; }
  .ocs-md-body table { border-collapse: collapse; width: 100%; margin: 6px 0; }
  .ocs-md-body td { border: 1px solid var(--ocs-border); padding: 6px 8px; font-size: 13px; }
  .ocs-md-body li { margin: 3px 0; font-size: 13px; }
  .ocs-md-body p { font-size: 13px; margin: 4px 0; }
  .ocs-md-body .ocs-md-task { display: block; font-size: 13px; margin: 4px 0; }
  .ocs-md-note { color: var(--ocs-text-muted); font-size: 12px; }
</style>
</head>
<body>
<div id="app"></div>
<script src="./preview.js?v=${buildId}"></script>
</body>
</html>`;
writeFileSync(`${outdir}/index.html`, html, "utf8");
console.log(`preview built → ${outdir}/index.html`);
