#!/usr/bin/env node
//
// 把桌宠 hooks 装进 Claude Code 的用户级配置 ~/.claude/settings.json。
//
// 用法：
//   node pet/claude-code/install.js              安装（幂等，可重复跑）
//   node pet/claude-code/install.js --uninstall  卸载
//
// 做两件事：
//   1. 把 hook.js + lib/ 拷到稳定路径 ~/.sema/pet/claude-code/，
//      让全局 hooks 不依赖本仓库 checkout 位置（改了脚本要重跑本命令同步）。
//   2. 幂等地把 7 个 hook 合并进 ~/.claude/settings.json，只动自己写的那几条。

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { PET_DIR } = require('./lib/protocol');

const SRC_DIR = __dirname;
const STABLE_DIR = path.join(PET_DIR, 'claude-code');
const HOOK_PATH = path.join(STABLE_DIR, 'hook.js');
const SETTINGS_PATH = path.join(os.homedir(), '.claude', 'settings.json');

// Claude Code hook 事件 → hook.js 的事件参数。matcher 仅工具事件需要。
const HOOKS = [
  { event: 'SessionStart', arg: 'session-start' },
  { event: 'UserPromptSubmit', arg: 'prompt-submit' },
  { event: 'PreToolUse', arg: 'pre-tool', matcher: '*' },
  { event: 'PostToolUse', arg: 'post-tool', matcher: '*' },
  { event: 'Notification', arg: 'notification' },
  { event: 'Stop', arg: 'stop' },
  { event: 'SessionEnd', arg: 'session-end' },
];

// 命令里用绝对 node 路径 + 稳定 hook 路径，统一正斜杠（Windows 的 node 也认）。
function toCmd(arg) {
  const node = process.execPath.split(path.sep).join('/');
  const hook = HOOK_PATH.split(path.sep).join('/');
  return `"${node}" "${hook}" ${arg}`;
}

// 是否本工具写入的 hook（按命令里是否含稳定 hook 路径判别）。
function isOurs(group) {
  const hookSig = HOOK_PATH.split(path.sep).join('/');
  return Array.isArray(group?.hooks)
    && group.hooks.some((h) => typeof h?.command === 'string' && h.command.includes(hookSig));
}

function copyTree(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyTree(s, d);
    else fs.copyFileSync(s, d);
  }
}

function copyScripts() {
  // 从稳定路径跑 install 时 src === dest，跳过自拷
  let same = false;
  try { same = fs.realpathSync(SRC_DIR) === fs.realpathSync(STABLE_DIR); } catch {}
  if (same) return;
  copyTree(SRC_DIR, STABLE_DIR);
}

function readSettings() {
  if (!fs.existsSync(SETTINGS_PATH)) return {};
  const raw = fs.readFileSync(SETTINGS_PATH, 'utf8');
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch (e) {
    console.error(`❌ ${SETTINGS_PATH} 不是合法 JSON，已中止以免覆盖你的配置：${e.message}`);
    process.exit(1);
  }
}

function writeSettings(settings) {
  fs.mkdirSync(path.dirname(SETTINGS_PATH), { recursive: true });
  // 原子写：先写临时文件再 rename
  const tmp = `${SETTINGS_PATH}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(settings, null, 2) + '\n');
  fs.renameSync(tmp, SETTINGS_PATH);
}

// 先剔除本工具旧条目（幂等），再按需追加新条目。
function stripOurs(settings) {
  if (!settings.hooks) return;
  for (const event of Object.keys(settings.hooks)) {
    const arr = settings.hooks[event];
    if (!Array.isArray(arr)) continue;
    settings.hooks[event] = arr.filter((g) => !isOurs(g));
    if (settings.hooks[event].length === 0) delete settings.hooks[event];
  }
  if (Object.keys(settings.hooks).length === 0) delete settings.hooks;
}

function install() {
  copyScripts();
  const settings = readSettings();
  stripOurs(settings);
  settings.hooks = settings.hooks || {};
  for (const { event, arg, matcher } of HOOKS) {
    settings.hooks[event] = settings.hooks[event] || [];
    const group = { hooks: [{ type: 'command', command: toCmd(arg) }] };
    if (matcher) group.matcher = matcher;
    settings.hooks[event].push(group);
  }
  writeSettings(settings);
  console.log('✅ 桌宠 hooks 已装进', SETTINGS_PATH);
  console.log('   脚本位于', STABLE_DIR);
  console.log('   新开的 Claude Code 会话即生效（已开的会话需重启）。');
}

function uninstall() {
  const settings = readSettings();
  stripOurs(settings);
  writeSettings(settings);
  console.log('✅ 已从', SETTINGS_PATH, '移除桌宠 hooks');
  console.log('   稳定路径脚本仍保留在', STABLE_DIR, '（如需彻底清理可手动删除）。');
}

if (process.argv.includes('--uninstall')) uninstall();
else install();
