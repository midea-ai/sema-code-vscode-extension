/**
 * Claw 自身的轻量偏好，存于 ~/.sema/claw/settings.json。
 *
 * 与 credentials-store 一样是纯 fs 的静态模块：coordinator 可静态引用而不触发
 * 懒载重 chunk，bridge 也可在每次事件处廉价读取，使运行中改设置即时生效。
 *
 * 目前只有一项：信息显示详略（控制 bridge 发回微信手机端的内容多少）。
 */
import fs from "node:fs";
import path from "node:path";

import { clawSettingsPath } from "./paths";

/** 信息显示详略档位：详细 / 中等 / 简单 / 极简。 */
export type ClawVerbosity = "detailed" | "medium" | "simple" | "minimal";

const VALID: ReadonlySet<string> = new Set<ClawVerbosity>([
  "detailed",
  "medium",
  "simple",
  "minimal",
]);

interface ClawSettings {
  verbosity?: ClawVerbosity;
}

function safeReadJson<T>(p: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(p, "utf-8")) as T;
  } catch {
    return null;
  }
}

/** 读取当前详略档；文件缺失或非法值时回退到 "detailed"。 */
export function loadClawVerbosity(): ClawVerbosity {
  const s = safeReadJson<ClawSettings>(clawSettingsPath());
  const v = s?.verbosity;
  return v && VALID.has(v) ? v : "detailed";
}

/** 写入详略档（合并保留 settings.json 中的其它字段）。 */
export function saveClawVerbosity(level: ClawVerbosity): void {
  if (!VALID.has(level)) return;
  const file = clawSettingsPath();
  const cur = safeReadJson<ClawSettings>(file) ?? {};
  const next: ClawSettings = { ...cur, verbosity: level };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(next, null, 2));
}
