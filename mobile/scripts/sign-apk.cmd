@echo off
rem Double-click to build the signed release APK. Runs apk-release-prompt.ps1 from the mobile folder in
rem a window you can see (it asks for the key folder and both passwords). A window opened for you by
rem another program can start hidden and wait at the first question, unseen (2026-10-10).
cd /d "%~dp0.."
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\apk-release-prompt.ps1 %*
echo.
pause
