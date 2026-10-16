@echo off
chcp 65001 >nul
cd /d "%~dp0"
set PORT=5173
where node >nul 2>nul
if %errorlevel%==0 (
  echo 啟動 L7N Fantasy Lab：http://localhost:%PORT%/   （關閉此視窗即停止）
  start "" "http://localhost:%PORT%/"
  node scripts\serve.mjs %PORT%
  goto :eof
)
where py >nul 2>nul
if %errorlevel%==0 (
  echo 找不到 Node.js，改用 Python：http://localhost:%PORT%/
  start "" "http://localhost:%PORT%/"
  py -m http.server %PORT%
  goto :eof
)
echo 需要安裝 Node.js（https://nodejs.org）或 Python 才能啟動本機伺服器。
echo 也可以先執行 build，然後直接雙擊 dist\L7N-Fantasy-Lab-*-standalone.html（不需要伺服器）。
pause
