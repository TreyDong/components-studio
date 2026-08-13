import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const alias = {
  // 子路径别名必须先于裸别名，避免 Vite 前缀匹配把 @ocs/contracts/document 解析到 index.ts 下。
  "@ocs/contracts/common": fileURLToPath(new URL("./src/contracts/common.ts", import.meta.url)),
  "@ocs/contracts/document": fileURLToPath(new URL("./src/contracts/document.ts", import.meta.url)),
  "@ocs/contracts/query": fileURLToPath(new URL("./src/contracts/query.ts", import.meta.url)),
  "@ocs/contracts": fileURLToPath(new URL("./src/contracts/index.ts", import.meta.url)),
};

export default defineConfig({
  plugins: [react()],
  resolve: { alias },
  test: {
    environment: "jsdom",
    include: ["tests/**/*.test.{ts,tsx}"],
    globals: false,
    setupFiles: [],
  },
});
