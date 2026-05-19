#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const distDir = path.join(repoRoot, 'dist', 'pet');

const zips = [
  {
    source: path.join(
      repoRoot,
      'pet',
      'macos',
      '.build',
      'arm64-apple-macosx',
      'release',
      'sema-pet-darwin-arm64.zip',
    ),
    fileName: 'sema-pet-darwin-arm64.zip',
  },
  {
    source: path.join(
      repoRoot,
      'pet',
      'macos',
      '.build',
      'x86_64-apple-macosx',
      'release',
      'sema-pet-darwin-x64.zip',
    ),
    fileName: 'sema-pet-darwin-x64.zip',
  },
];

fs.mkdirSync(distDir, { recursive: true });

for (const zip of zips) {
  const destination = path.join(distDir, zip.fileName);

  if (!fs.existsSync(zip.source)) {
    console.warn(
      `[pet] dist/pet/${zip.fileName} missing. Run npm run pet:build on macOS to create it.`,
    );
    continue;
  }

  fs.copyFileSync(zip.source, destination);
  console.log(`[pet] staged dist/pet/${zip.fileName}`);
}
