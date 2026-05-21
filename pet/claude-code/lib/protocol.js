// 桌宠通信协议常量 —— 与 src/pet/pet-types.ts 保持一致，改一边记得同步另一边。
//
// Claude Code 端是纯 CommonJS、零外部依赖（hook 进程不保证有 node_modules），
// 所以这里把 TS 那份常量原样镜像一份。

'use strict';

const os = require('os');
const path = require('path');

const PET_HOST = '127.0.0.1';
const PET_PORT = 24700;
const PET_SERVER_HEADER = 'x-sema-pet';
const PET_SERVER_HEADER_VALUE = 'server';

const PET_DIR = path.join(os.homedir(), '.sema', 'pet');

// platform/arch → zip 名，严格对齐 process.platform-process.arch（同 pet-launcher.ts）
const PLATFORM_KEY = `${process.platform}-${process.arch}`;        // e.g. darwin-arm64
const ZIP_NAME = `sema-pet-${PLATFORM_KEY}.zip`;
const BIN_DIR = path.join(PET_DIR, 'bin', PLATFORM_KEY);
const BIN_NAME = process.platform === 'win32' ? 'SemaPet.exe' : 'SemaPet';
const BIN_PATH = path.join(BIN_DIR, BIN_NAME);

// 桌宠各平台 zip 发布在 GitHub 的 pet-assets Release（固定 tag、无版本号、只留最新一份）。
// 与 pet/fetch-zips.js 同源。
const RELEASE_BASE =
  'https://github.com/midea-ai/sema-code-vscode-extension/releases/download/pet-assets';
const ZIP_URL = `${RELEASE_BASE}/${ZIP_NAME}`;

// PetState：idle | thinking | working | attention | sleeping
// server 端按优先级跨会话聚合（attention > thinking > working > idle > sleeping）。
const SAY_MAX_CHARS = 40;

const SUPPORTED_PLATFORMS = ['darwin', 'win32', 'linux'];

module.exports = {
  PET_HOST,
  PET_PORT,
  PET_SERVER_HEADER,
  PET_SERVER_HEADER_VALUE,
  PET_DIR,
  PLATFORM_KEY,
  ZIP_NAME,
  BIN_DIR,
  BIN_NAME,
  BIN_PATH,
  RELEASE_BASE,
  ZIP_URL,
  SAY_MAX_CHARS,
  SUPPORTED_PLATFORMS,
};
