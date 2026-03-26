#!/bin/bash
# ./package-all.sh
# 为各平台分别下载 ripgrep 二进制并打包 vsix

set -e

RG_VERSION="14.1.0"
BIN_DIR="node_modules/@vscode/ripgrep/bin"
mkdir -p "$BIN_DIR"

package_platform() {
  local TARGET=$1
  local PLATFORM=$2
  local BIN_NAME=$3
  local DOWNLOAD_URL=$4

  echo "=== 打包 $TARGET ==="

  # 清空 bin 目录，只放当前平台的文件
  rm -f "$BIN_DIR/rg" "$BIN_DIR/rg.exe"

  echo "下载 $TARGET 的 ripgrep..."
  if [[ "$PLATFORM" == "win32" ]]; then
    curl -sL "$DOWNLOAD_URL" -o rg-tmp.zip
    unzip -q rg-tmp.zip
    mv ripgrep-*/"$BIN_NAME" "$BIN_DIR/$BIN_NAME"
    rm -rf ripgrep-* rg-tmp.zip
  else
    curl -sL "$DOWNLOAD_URL" | tar xz
    mv ripgrep-*/rg "$BIN_DIR/rg"
    chmod +x "$BIN_DIR/rg"
    rm -rf ripgrep-*
  fi

  vsce package --target "$TARGET"
  echo "✓ $TARGET 打包完成"
}

package_platform "darwin-x64" "darwin" "rg" \
  "https://github.com/BurntSushi/ripgrep/releases/download/$RG_VERSION/ripgrep-$RG_VERSION-x86_64-apple-darwin.tar.gz"

package_platform "darwin-arm64" "darwin" "rg" \
  "https://github.com/BurntSushi/ripgrep/releases/download/$RG_VERSION/ripgrep-$RG_VERSION-aarch64-apple-darwin.tar.gz"

package_platform "linux-x64" "linux" "rg" \
  "https://github.com/BurntSushi/ripgrep/releases/download/$RG_VERSION/ripgrep-$RG_VERSION-x86_64-unknown-linux-musl.tar.gz"

package_platform "win32-x64" "win32" "rg.exe" \
  "https://github.com/BurntSushi/ripgrep/releases/download/$RG_VERSION/ripgrep-$RG_VERSION-x86_64-pc-windows-msvc.zip"

echo "=== 恢复当前平台的 ripgrep 二进制 ==="
rm -f "$BIN_DIR/rg" "$BIN_DIR/rg.exe"
_OS=$(uname -s)
_ARCH=$(uname -m)
if [[ "$_OS" == "Darwin" && "$_ARCH" == "arm64" ]]; then
  curl -sL "https://github.com/BurntSushi/ripgrep/releases/download/$RG_VERSION/ripgrep-$RG_VERSION-aarch64-apple-darwin.tar.gz" | tar xz
  mv ripgrep-*/rg "$BIN_DIR/rg" && chmod +x "$BIN_DIR/rg" && rm -rf ripgrep-*
elif [[ "$_OS" == "Darwin" ]]; then
  curl -sL "https://github.com/BurntSushi/ripgrep/releases/download/$RG_VERSION/ripgrep-$RG_VERSION-x86_64-apple-darwin.tar.gz" | tar xz
  mv ripgrep-*/rg "$BIN_DIR/rg" && chmod +x "$BIN_DIR/rg" && rm -rf ripgrep-*
elif [[ "$_OS" == "Linux" ]]; then
  curl -sL "https://github.com/BurntSushi/ripgrep/releases/download/$RG_VERSION/ripgrep-$RG_VERSION-x86_64-unknown-linux-musl.tar.gz" | tar xz
  mv ripgrep-*/rg "$BIN_DIR/rg" && chmod +x "$BIN_DIR/rg" && rm -rf ripgrep-*
fi

echo "=== 全部完成，输出在 dist/ ==="
