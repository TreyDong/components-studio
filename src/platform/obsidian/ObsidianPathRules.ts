/**
 * PathRules 的 Obsidian 实现（《运行时与 SDK 协议 v1》第 4.2 节）。
 *
 * 所有路径统一 `/`，不得为空、以 `/` 开头、含 NUL，或经归一化后逃出 Vault。
 * `..` 只允许在相对解析阶段出现；最终结果必须在 Vault 内。
 *
 * 实现同时做两件事：
 * 1. 用 Obsidian normalizePath() 做分隔符统一与折叠（`\` → `/`、`//` → `/`）；
 * 2. 自己逐段解析 `.`/`..`，拒绝任何逃出 Vault 根目录的 `..`。
 *    不依赖 normalizePath 对 `..` 的处理细节，保证安全边界。
 */

import type { PathRules } from "../ports";
import type { ProtocolError, Result } from "@ocs/contracts";
import { fail, lazyNormalizePath, ok, platformError } from "./obsidian-api";

const PATH_CODE = "EXTERNAL_FILE_INVALID" as const;

function pathError(message: string, path?: string): ProtocolError {
  return platformError(PATH_CODE, message, { path });
}

/** 父目录（`a/b/c` → `a/b`；无分隔符 → `""`）。 */
export function parentDir(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx <= 0 ? "" : path.slice(0, idx);
}

export class ObsidianPathRules implements PathRules {
  private readonly normalizePath: (path: string) => string;

  constructor(options?: { readonly normalize?: (path: string) => string }) {
    this.normalizePath = options?.normalize ?? lazyNormalizePath;
  }

  normalize(input: string): Result<string> {
    if (input.length === 0) {
      return fail(pathError("路径不得为空"));
    }
    if (input.includes("\u0000")) {
      return fail(pathError("路径不得包含 NUL 字符", input));
    }
    if (input.startsWith("/")) {
      return fail(pathError("路径不得以 / 开头（Obsidian 路径相对 Vault 根）", input));
    }
    // 分隔符统一；随后逐段解析 `.`/`..`。
    const raw = input.replace(/\\/g, "/");
    const segments = raw.split("/");
    const out: string[] = [];
    for (const segment of segments) {
      if (segment === "" || segment === ".") {
        continue;
      }
      if (segment === "..") {
        if (out.length === 0) {
          return fail(pathError(`路径 "${input}" 逃出 Vault 根目录`));
        }
        out.pop();
        continue;
      }
      out.push(segment);
    }
    if (out.length === 0) {
      return fail(pathError("路径归一化后为空", input));
    }
    // 最终再做一次 Obsidian 规范化，得到规范形态（折叠重复分隔符等）。
    const normalized = this.normalizePath(out.join("/"));
    if (
      normalized.length === 0 ||
      normalized.startsWith("/") ||
      normalized.includes("\u0000")
    ) {
      return fail(pathError("路径归一化结果非法", input));
    }
    return ok(normalized);
  }

  resolve(
    input: string,
    options: {
      readonly sourcePath: string;
      readonly defaultBase: "vault" | "source-directory";
    },
  ): Result<string> {
    if (input.startsWith("/")) {
      return fail(pathError("相对路径不得以 / 开头", input));
    }
    if (options.defaultBase === "source-directory") {
      const base = parentDir(options.sourcePath);
      const combined = base.length === 0 ? input : `${base}/${input}`;
      return this.normalize(combined);
    }
    return this.normalize(input);
  }

  isInsideVault(path: string): boolean {
    return this.normalize(path).ok;
  }
}
