#!/usr/bin/env node

const { spawnSync } = require('child_process');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const requestedTarget = process.argv[2] || 'all';

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: 'inherit',
    shell: false,
  });

  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }

  process.exit(result.status ?? 1);
}

function normalizeTarget(target) {
  switch (target) {
    case 'all':
    case 'arm64':
    case 'x64':
    case 'x86_64':
      return target;
    default:
      console.error(`Unknown pet build target: ${target}. Use all, arm64, or x64.`);
      process.exit(1);
  }
}

const target = normalizeTarget(requestedTarget);

if (process.platform === 'darwin') {
  const script = path.join(repoRoot, 'pet', 'macos', 'build-zips.sh');
  run('bash', target === 'all' ? [script] : [script, target]);
}

if (process.platform === 'win32') {
  const script = path.join(repoRoot, 'pet', 'windows', 'build-zips.ps1');
  const targets =
    target === 'all'
      ? ['x86_64-pc-windows-msvc']
      : [
          target === 'arm64'
            ? 'aarch64-pc-windows-msvc'
            : 'x86_64-pc-windows-msvc',
        ];

  for (const rustTarget of targets) {
    const result = spawnSync(
      'powershell.exe',
      ['-ExecutionPolicy', 'Bypass', '-File', script, '-Target', rustTarget],
      {
        cwd: repoRoot,
        stdio: 'inherit',
        shell: false,
      },
    );

    if (result.error) {
      console.error(result.error.message);
      process.exit(1);
    }

    if (result.status !== 0) {
      process.exit(result.status ?? 1);
    }
  }

  process.exit(0);
}

console.error(
  `Pet build is only supported on macOS and Windows. Current platform: ${process.platform}.`,
);
process.exit(1);
