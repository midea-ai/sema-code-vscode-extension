#!/usr/bin/env node
//
// 现场编译当前平台的桌宠，zip 直接落 dist/pet/。
// 用法：
//   node pet/build-zips.js            # 默认 all
//   node pet/build-zips.js arm64      # 仅 arm64
//   node pet/build-zips.js x64        # 仅 x64
//
// macOS：swift toolchain 自带 x86_64 target，一台 Apple Silicon 即可出两架构。
// Windows：'all' 仅打 x64；arm64 需显式指定。
// 跨平台拉取全部平台 zip 用 pet/fetch-zips.js（npm run pet:fetch）。

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const distPetDir = path.join(repoRoot, 'dist', 'pet');

function run(command, args, opts = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', shell: false, ...opts });
  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function normalizeTarget(target) {
  switch (target) {
    case 'all':
    case 'arm64':
    case 'x64':
      return target;
    case 'x86_64':
      return 'x64';
    default:
      console.error(`未知构建目标: ${target}（可选 all | arm64 | x64）`);
      process.exit(1);
  }
}

// ---------- macOS ----------
function buildMac(arch) {
  const swiftArch = arch === 'arm64' ? 'arm64' : 'x86_64';
  const macDir = path.join(repoRoot, 'pet', 'macos');
  const releaseDir = path.join(macDir, '.build', `${swiftArch}-apple-macosx`, 'release');
  const zipName = `sema-pet-darwin-${arch}.zip`;

  console.log(`▶︎ building ${zipName}`);
  run('swift', ['build', '-c', 'release', '--arch', swiftArch], { cwd: macDir });

  // ad-hoc 签名：必须，不签在 Apple Silicon 上会被内核直接 Killed: 9
  run('codesign', ['-s', '-', '--force', path.join(releaseDir, 'SemaPet')]);

  // 保留系统 zip + -y（存符号链接），不用 adm-zip，避免破坏 .bundle
  // -x '*.DS_Store'：排除 Finder 生成的垃圾文件
  const zipPath = path.join(releaseDir, zipName);
  fs.rmSync(zipPath, { force: true });
  run(
    'zip',
    ['-yr', zipName, 'SemaPet', 'SemaPet_SemaPet.bundle', '-x', '*.DS_Store'],
    { cwd: releaseDir },
  );

  fs.copyFileSync(zipPath, path.join(distPetDir, zipName));
  console.log(`✓ dist/pet/${zipName}`);
}

// ---------- Windows ----------
function buildWindows(arch) {
  const AdmZip = require('adm-zip');
  const rustTarget =
    arch === 'arm64' ? 'aarch64-pc-windows-msvc' : 'x86_64-pc-windows-msvc';
  const winDir = path.join(repoRoot, 'pet', 'windows');
  const exePath = path.join(winDir, 'target', rustTarget, 'release', 'SemaPet.exe');
  const zipName = `sema-pet-win32-${arch}.zip`;

  console.log(`▶︎ building ${zipName}`);
  run('cargo', ['build', '--release', '--target', rustTarget], {
    cwd: winDir,
    // 静态链接 CRT，产物为单文件 exe
    env: { ...process.env, RUSTFLAGS: '-C target-feature=+crt-static' },
    shell: true, // Windows 上 cargo 解析需要走 shell
  });

  if (!fs.existsSync(exePath)) {
    console.error(`未找到构建产物: ${exePath}`);
    process.exit(1);
  }

  // exe 单文件，adm-zip 安全；放在 zip 根，名为 SemaPet.exe
  const zipPath = path.join(distPetDir, zipName);
  fs.rmSync(zipPath, { force: true });
  const zip = new AdmZip();
  zip.addLocalFile(exePath);
  zip.writeZip(zipPath);
  console.log(`✓ dist/pet/${zipName}`);
}

const requested = normalizeTarget(process.argv[2] || 'all');

fs.mkdirSync(distPetDir, { recursive: true });

if (process.platform === 'darwin') {
  const arches = requested === 'all' ? ['arm64', 'x64'] : [requested];
  for (const arch of arches) buildMac(arch);
} else if (process.platform === 'win32') {
  const arches = requested === 'all' ? ['x64'] : [requested];
  for (const arch of arches) buildWindows(arch);
} else {
  console.error(`桌宠构建仅支持 macOS 和 Windows，当前平台: ${process.platform}`);
  process.exit(1);
}

console.log('✅ 完成。下一步 npm run compile（纯 webpack），再 ./package-all.sh');
