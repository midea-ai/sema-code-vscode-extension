// 把 src/server.ts + sema-core 打成单个 dist/server.js（对齐 VSCode 打 extension.js 的做法）。
// 目标：sidecar 不再依赖 node_modules，只需系统 node + 同级 proto/sema.proto。
import { build } from 'esbuild';
import { existsSync } from 'fs';

const isWatch = process.argv.includes('--watch');

const options = {
  entryPoints: ['src/server.ts'],
  outfile: 'dist/server.js',
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'cjs',
  minify: true,
  sourcemap: false,
  // rg 走系统 PATH 提供（Kotlin 首启下载后前置进 PATH），sema-core 对 @vscode/ripgrep
  // 的回退 require 永不命中；external 掉它，避免把空的平台占位包打进来（对齐 VSCode externals）。
  external: ['@vscode/ripgrep'],
  logLevel: 'info',
  // sema-core 内部可能有对用户文件的动态 require（插件/MCP 运行时加载），保持为原生 require。
  // esbuild 对无法静态解析的 require 会保留并告警，cjs 下运行时即 node require，符合预期。
  logOverride: { 'unsupported-dynamic-import': 'silent' },
};

if (isWatch) {
  const ctx = await (await import('esbuild')).context(options);
  await ctx.watch();
  console.log('[esbuild] watching…');
} else {
  await build(options);
  if (!existsSync('dist/server.js')) {
    console.error('[esbuild] 构建失败：未产出 dist/server.js');
    process.exit(1);
  }
  console.log('[esbuild] built dist/server.js');
}
