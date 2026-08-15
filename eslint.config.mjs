import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["main.js", "node_modules/**", "dist/**", "dist-preview/**", "coverage/**", ".playwright-cli/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["esbuild.config.mjs", "vitest.config.ts", "scripts/*.mjs"],
    languageOptions: {
      globals: { console: "readonly", process: "readonly" },
    },
  },
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // 安全：禁止动态执行文档字符串。
      "no-eval": "error",
      "no-new-func": "error",
      "@typescript-eslint/no-explicit-any": "error",
    },
  },
  {
    files: ["src/widgets/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            { name: "obsidian", message: "widgets 不得 import obsidian" },
            { name: "electron", message: "widgets 不得 import electron" },
          ],
          patterns: [
            {
              group: ["**/platform/**", "**/ObsidianPlatformAdapter*", "**/ObsidianStorageAdapter*"],
              message: "widgets 不得 import platform 实现",
            },
          ],
        },
      ],
    },
  },
);
