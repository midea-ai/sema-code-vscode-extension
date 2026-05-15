#!/usr/bin/env bash
# 构建 SemaPet zip。
# 用法：
#   bash build-zips.sh              # arm64 + x64（默认，发布用）
#   bash build-zips.sh arm64        # 仅 arm64（本机测试快得多）
#   bash build-zips.sh x64          # 仅 x64
# 产物：
#   pet/macos/.build/arm64-apple-macosx/release/sema-pet-darwin-arm64.zip
#   pet/macos/.build/x86_64-apple-macosx/release/sema-pet-darwin-x64.zip
# 由 npm run compile 自动 cp 到 dist/pet/。

set -euo pipefail

cd "$(dirname "$0")"        # 切到 pet/macos

TARGET="${1:-all}"

build_zip() {
    local arch_flag="$1"    # "--arch arm64" 或 "--arch x86_64"
    local out_subdir="$2"   # .build/{arch}-apple-macosx/release
    local zip_name="$3"     # sema-pet-darwin-arm64.zip 或 sema-pet-darwin-x64.zip

    echo "▶︎ building $zip_name"
    # shellcheck disable=SC2086
    swift build -c release $arch_flag
    codesign -s - --force "$out_subdir/SemaPet"
    (cd "$out_subdir" && rm -f "$zip_name" && zip -yr "$zip_name" SemaPet SemaPet_SemaPet.bundle)
    echo "✓ $out_subdir/$zip_name"
}

case "$TARGET" in
    arm64)
        build_zip "--arch arm64"  ".build/arm64-apple-macosx/release"   "sema-pet-darwin-arm64.zip"
        ;;
    x64|x86_64)
        build_zip "--arch x86_64" ".build/x86_64-apple-macosx/release"  "sema-pet-darwin-x64.zip"
        ;;
    all)
        # 两个架构都显式指定 --arch，走独立子目录，避免 .build/release symlink 被后跑的 build 覆写
        build_zip "--arch arm64"  ".build/arm64-apple-macosx/release"   "sema-pet-darwin-arm64.zip"
        build_zip "--arch x86_64" ".build/x86_64-apple-macosx/release"  "sema-pet-darwin-x64.zip"
        ;;
    *)
        echo "❌ 未知参数: $TARGET（可选: arm64 | x64 | all）" >&2
        exit 1
        ;;
esac

echo "✅ 完成。下一步 npm run compile 会把 zip cp 到 dist/pet/"
