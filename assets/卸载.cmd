@echo off
rem ===========================================================================
rem  Cute Fat Fish Pet - portable uninstall launcher (keep this file PURE ASCII)
rem ---------------------------------------------------------------------------
rem  Same rules as the setup launcher: pure ASCII, look for uninstall.ps1 first,
rem  and always pause. All Chinese wording lives in uninstall.ps1 (UTF-8 BOM).
rem ===========================================================================
setlocal
title Cute Fat Fish Pet - uninstall
rem  Do NOT leave the current directory inside the install folder: this script deletes that
rem  folder, and Windows PowerShell 5.1 refuses to remove the folder it is currently in.
cd /d "%TEMP%" 2>nul || cd /d "%SystemRoot%"

set "PS=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
if not exist "%PS%" set "PS=powershell"

if not exist "%~dp0uninstall.ps1" (
  echo.
  echo   [x] uninstall.ps1 is not next to this file.
  echo       Uninstall from the whole extracted folder, or use Uninstall.exe in the install folder.
  echo.
  pause
  exit /b 1
)

"%PS%" -NoProfile -ExecutionPolicy Bypass -File "%~dp0uninstall.ps1" %*
set "RC=%ERRORLEVEL%"
echo.
if not "%RC%"=="0" echo   [x] Uninstall did not finish. Exit code: %RC%
echo.
pause
exit /b %RC%
