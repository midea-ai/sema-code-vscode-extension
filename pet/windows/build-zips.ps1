param(
  [string]$Target = "x86_64-pc-windows-msvc",
  [switch]$StaticCrt
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Resolve-Path (Join-Path $ScriptDir "..\..")
$DistDir = Join-Path $RepoRoot "dist\pet"
$StageDir = Join-Path $ScriptDir "target\package\sema-pet-win32-x64"
$ExePath = Join-Path $ScriptDir "target\$Target\release\SemaPet.exe"
$ZipPath = Join-Path $DistDir "sema-pet-win32-x64.zip"

if ($StaticCrt) {
  $env:RUSTFLAGS = "-C target-feature=+crt-static"
} else {
  Remove-Item Env:\RUSTFLAGS -ErrorAction SilentlyContinue
}

Push-Location $ScriptDir
try {
  cargo build --release --target $Target

  if (!(Test-Path $ExePath)) {
    throw "Expected executable was not produced: $ExePath"
  }

  if (Test-Path $StageDir) {
    Remove-Item -LiteralPath $StageDir -Recurse -Force
  }
  New-Item -ItemType Directory -Force -Path $StageDir | Out-Null
  New-Item -ItemType Directory -Force -Path $DistDir | Out-Null

  Copy-Item -LiteralPath $ExePath -Destination (Join-Path $StageDir "SemaPet.exe")

  if (Test-Path (Join-Path $StageDir "Assets")) {
    throw "Package staging directory must not contain loose Assets."
  }

  if (Test-Path $ZipPath) {
    Remove-Item -LiteralPath $ZipPath -Force
  }
  Compress-Archive -Path (Join-Path $StageDir "SemaPet.exe") -DestinationPath $ZipPath

  Write-Host "Wrote $ZipPath"
}
finally {
  Pop-Location
}
