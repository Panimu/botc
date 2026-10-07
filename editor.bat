@echo off
rem Opens the question editor: starts its server (in a minimised window) unless
rem it's already running, then opens http://localhost:8010 in the default browser.
cd /d "%~dp0"
powershell -NoProfile -Command "try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 http://127.0.0.1:8010/ | Out-Null; exit 0 } catch { exit 1 }"
if errorlevel 1 (
  start "Question editor server" /min cmd /k node tools\editor\server.js
  powershell -NoProfile -Command "for ($i = 0; $i -lt 20; $i++) { try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 1 http://127.0.0.1:8010/ | Out-Null; exit 0 } catch { Start-Sleep -Milliseconds 250 } }"
)
start "" http://localhost:8010/
