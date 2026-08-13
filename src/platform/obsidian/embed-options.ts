/**
 * `.components` Markdown code block 语法解析（《运行时与 SDK 协议 v1》第 4.7 节）。
 *
 * 受控逐行 `key: value` 小语法，不是 YAML：
 * - 允许空行；不允许注释、锚点、多行值、对象或数组。
 * - `src` 必填，使用未引号的行尾文本（V1 不实现引号转义）。
 * - `mode` V1 只能是 `view`。
 * - `height` 为 `auto` 或 100..10000 的十进制整数像素。
 * - `maxWidth` 可省略，存在时为 240..4000 的十进制整数像素。
 * - 同一 key 重复、未知 key、非法值均报错（带行号，供局部诊断）。
 */

import type { Result } from "@ocs/contracts";
import { fail, ok, platformError } from "./obsidian-api";

export interface ComponentsEmbedOptions {
  readonly src: string;
  readonly mode: "view";
  readonly height: "auto" | number;
  readonly maxWidth?: number;
}

export interface EmbedOptionDiagnostic {
  readonly message: string;
  readonly line: number;
}

const ALLOWED_KEYS = ["src", "mode", "height", "maxWidth"] as const;
const MODE = "view" as const;

function diagnostic(
  message: string,
  line: number,
): { ok: false; error: { message: string; line: number } } {
  return {
    ok: false,
    error: {
      message: `components 代码块：${message}`,
      line,
    },
  };
}

function parseIntStrict(value: string): number | null {
  if (!/^[0-9]+$/.test(value)) {
    return null;
  }
  const n = Number(value);
  return Number.isSafeInteger(n) ? n : null;
}

/**
 * 解析代码块 source。返回的 Result 错误是嵌入诊断对象（非 ProtocolError），
 * 因为本解析器是局部语法检查，错误直接渲染为行内诊断，不进入统一错误管道。
 */
export function parseComponentsEmbedOptions(
  source: string,
): Result<ComponentsEmbedOptions, EmbedOptionDiagnostic> {
  const lines = source.split(/\r?\n/);
  const seen = new Set<string>();
  let src: string | null = null;
  let mode: "view" | null = null;
  let height: "auto" | number | null = null;
  let maxWidth: number | null = null;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i]!.trim();
    if (trimmed.length === 0) {
      continue;
    }
    const colon = trimmed.indexOf(":");
    if (colon < 0) {
      return diagnostic(`第 ${i + 1} 行缺少 ":"，期望 key: value`, i + 1);
    }
    const key = trimmed.slice(0, colon).trim();
    const rawValue = trimmed.slice(colon + 1).trim();
    if (!(ALLOWED_KEYS as readonly string[]).includes(key)) {
      return diagnostic(`未知 key "${key}"`, i + 1);
    }
    if (seen.has(key)) {
      return diagnostic(`key "${key}" 重复`, i + 1);
    }
    seen.add(key);

    if (key === "src") {
      if (rawValue.length === 0) {
        return diagnostic("src 不能为空", i + 1);
      }
      src = rawValue;
    } else if (key === "mode") {
      if (rawValue !== MODE) {
        return diagnostic(`mode 只能是 "${MODE}"，得到 "${rawValue}"`, i + 1);
      }
      mode = MODE;
    } else if (key === "height") {
      if (rawValue === "auto") {
        height = "auto";
      } else {
        const n = parseIntStrict(rawValue);
        if (n === null || n < 100 || n > 10000) {
          return diagnostic(
            `height 必须是 "auto" 或 100..10000 的整数，得到 "${rawValue}"`,
            i + 1,
          );
        }
        height = n;
      }
    } else {
      const n = parseIntStrict(rawValue);
      if (n === null || n < 240 || n > 4000) {
        return diagnostic(
          `maxWidth 必须是 240..4000 的整数，得到 "${rawValue}"`,
          i + 1,
        );
      }
      maxWidth = n;
    }
  }

  if (src === null) {
    return diagnostic("缺少必填 key " + `"src"`, 0);
  }
  if (mode === null) {
    return diagnostic(`缺少必填 key "mode"`, 0);
  }
  const base: ComponentsEmbedOptions = {
    src,
    mode,
    height: height ?? "auto",
  };
  if (maxWidth !== null) {
    return { ok: true, value: { ...base, maxWidth } };
  }
  return { ok: true, value: base };
}

/**
 * 解析并验证 src 目标路径（Vault 相对、`.components` 扩展名）。
 * 供 ComponentsEmbedChild 在 onload 时调用；失败返回 PlatformError。
 */
export function resolveEmbedSource(
  src: string,
  isInsideVault: (path: string) => boolean,
  normalize: (path: string) => Result<string>,
): Result<string> {
  const normalized = normalize(src);
  if (!normalized.ok) {
    return fail(platformError("EXTERNAL_FILE_INVALID", `src 路径非法：${normalized.error.message}`, { path: src }));
  }
  if (!normalized.value.endsWith(".components")) {
    return fail(
      platformError("EXTERNAL_FILE_INVALID", `src 必须是 .components 文件：${normalized.value}`, {
        path: normalized.value,
      }),
    );
  }
  if (!isInsideVault(normalized.value)) {
    return fail(
      platformError("EXTERNAL_FILE_INVALID", `src 必须在 Vault 内：${normalized.value}`, {
        path: normalized.value,
      }),
    );
  }
  return ok(normalized.value);
}
