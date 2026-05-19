#!/bin/bash
# ./package-all.sh
# 为各平台分别下载 ripgrep 二进制、保留对应平台桌宠 zip 并打包 vsix

set -e

RG_VERSION="14.1.0"
BIN_DIR="node_modules/@vscode/ripgrep/bin"
mkdir -p "$BIN_DIR"

# 桌宠 zip：dist/pet/ 下当前有全部平台的 zip（来自 npm run pet:fetch / pet:build）。
# 打包时每个平台只保留自己那一份，先把全部 zip 暂存起来。
PET_DIR="dist/pet"
PET_STASH="$(mktemp -d)"
mkdir -p "$PET_DIR"
if ls "$PET_DIR"/*.zip >/dev/null 2>&1; then
  cp "$PET_DIR"/*.zip "$PET_STASH"/
else
  echo "⚠️  dist/pet/ 下没有桌宠 zip，请先 npm run pet:fetch 或 npm run pet:build"
fi

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

  # 桌宠 zip：清空 dist/pet/，只放当前平台那一份（linux 无桌宠，留空）
  rm -f "$PET_DIR"/*.zip
  local PET_ZIP="sema-pet-${TARGET}.zip"
  if [[ -f "$PET_STASH/$PET_ZIP" ]]; then
    cp "$PET_STASH/$PET_ZIP" "$PET_DIR/"
    echo "桌宠 zip: $PET_ZIP"
  else
    echo "桌宠 zip: 无（$TARGET）"
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

echo "=== 恢复 dist/pet/ 下全部桌宠 zip ==="
rm -f "$PET_DIR"/*.zip
if ls "$PET_STASH"/*.zip >/dev/null 2>&1; then
  cp "$PET_STASH"/*.zip "$PET_DIR"/
fi
rm -rf "$PET_STASH"

echo "=== 全部完成，输出在 dist/ ==="
