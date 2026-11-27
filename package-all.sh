#!/bin/bash
# ./package-all.sh
# 打包单个全平台通用 VSIX（ripgrep 运行时优先复用 VS Code 内置 / 按需下载，桌宠按需下载）

set -euo pipefail

cd "$(dirname "$0")"

echo "=== 打包全平台通用 VSIX ==="
vsce package
echo "✓ 打包完成"
