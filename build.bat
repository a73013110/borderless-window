@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

:: ── 設定區 ────────────────────────────────────────
set ZIP_NAME=extension.zip
set WORK_DIR=%~dp0

echo 📦 開始打包 Chrome Extension...
echo.

:: ── 清除舊的 ZIP ──────────────────────────────────
if exist "%WORK_DIR%%ZIP_NAME%" (
    del "%WORK_DIR%%ZIP_NAME%"
    echo 🗑️  已刪除舊的 %ZIP_NAME%
)

:: ── 用 PowerShell 打包（保留相對路徑）────────────────
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "Set-Location '%WORK_DIR%';" ^
  "$zipPath = '%WORK_DIR%%ZIP_NAME%';" ^
  "$excludePatterns = @('.git', '.gitignore', 'claude.md', 'README.md', 'CHANGELOG.md', '.env', '.env.*', '.github', 'node_modules', 'build.bat', '*.zip', '.vscode', '.idea', '.claude', 'jsconfig.json');" ^
  "$allFiles = Get-ChildItem -Recurse -File | ForEach-Object {" ^
  "  $rel = $_.FullName.Substring((Get-Location).Path.Length + 1);" ^
  "  $skip = $false;" ^
  "  foreach ($p in $excludePatterns) {" ^
  "    $parts = $rel.Split('\');" ^
  "    foreach ($part in $parts) {" ^
  "      if ($part -like $p) { $skip = $true; break }" ^
  "    };" ^
  "    if ($skip) { break }" ^
  "  };" ^
  "  if (-not $skip) { $rel }" ^
  "};" ^
  "if ($allFiles) {" ^
  "  $tmp = New-TemporaryFile | ForEach-Object { Remove-Item $_; New-Item -ItemType Directory -Path $_.FullName };" ^
  "  $allFiles | ForEach-Object {" ^
  "    $dest = Join-Path $tmp $_;" ^
  "    $destDir = Split-Path $dest;" ^
  "    if (-not (Test-Path $destDir)) { New-Item -ItemType Directory -Path $destDir | Out-Null };" ^
  "    Copy-Item $_ $dest" ^
  "  };" ^
  "  Compress-Archive -Path (Join-Path $tmp '*') -DestinationPath $zipPath -Force;" ^
  "  Remove-Item $tmp -Recurse -Force;" ^
  "  Write-Host ('✅ 打包完成：%ZIP_NAME%，共 ' + $allFiles.Count + ' 個檔案')" ^
  "} else {" ^
  "  Write-Host '❌ 沒有找到任何檔案'" ^
  "}"

echo.
echo 🎉 完成！按任意鍵關閉...
pause >nul
