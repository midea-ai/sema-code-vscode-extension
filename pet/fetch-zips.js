#!/usr/bin/env node
//
// 从 GitHub 的 pet-assets Release 拉取全部平台桌宠 zip，直接落 dist/pet/。
// 用法：node pet/fetch-zips.js（npm run pet:fetch）
//
// pet-assets 是固定 tag、无版本号、只保留最新一份。发布扩展时用本脚本拉远程，
// 改了桌宠源码要重新构建则用 pet/build-zips.js（npm run pet:build）。二者落点一致。

const fs = require('fs');
const path = require('path');
const https = require('https');

const repoRoot = path.resolve(__dirname, '..');
const distPetDir = path.join(repoRoot, 'dist', 'pet');

const RELEASE_BASE =
  'https://github.com/midea-ai/sema-code-vscode-extension/releases/download/pet-assets';

const ZIPS = [
  'sema-pet-darwin-arm64.zip',
  'sema-pet-darwin-x64.zip',
  'sema-pet-win32-x64.zip',
];

function download(url, dest) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        // GitHub Release 资源会 302 跳到 CDN，跟随重定向
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          download(res.headers.location, dest).then(resolve, reject);
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`HTTP ${res.statusCode} — ${url}`));
          return;
        }
        const tmp = `${dest}.download`;
        const file = fs.createWriteStream(tmp);
        res.pipe(file);
        file.on('finish', () =>
          file.close(() => {
            fs.renameSync(tmp, dest);
            resolve();
          }),
        );
        file.on('error', (err) => {
          fs.rmSync(tmp, { force: true });
          reject(err);
        });
      })
      .on('error', reject);
  });
}

async function main() {
  fs.mkdirSync(distPetDir, { recursive: true });
  for (const name of ZIPS) {
    process.stdout.write(`下载 ${name} ... `);
    await download(`${RELEASE_BASE}/${name}`, path.join(distPetDir, name));
    console.log('✓');
  }
  console.log('✅ 完成。3 个桌宠 zip 已落 dist/pet/，下一步 npm run compile');
}

main().catch((err) => {
  console.error(`\n❌ 拉取失败: ${err.message}`);
  process.exit(1);
});
