@echo off
rem ===========================================================================
rem  Cute Fat Fish Pet - portable setup launcher (keep this file PURE ASCII)
rem ---------------------------------------------------------------------------
rem  Since 1.1.1 this file does only four things: find PowerShell, check that the
rem  whole package was really extracted, hand the Chinese UI over to install.ps1,
rem  and pause no matter what happens (before, a missing file meant a silent exit
rem  and the window vanished with no explanation -- docs/known-issues.md KI-1).
rem  It must not contain a single non-ASCII byte: cmd.exe reads .cmd as ANSI, so
rem  UTF-8 Chinese gets shredded into bogus commands (KI-3). The Chinese
rem  explanation travels as base64 through -EncodedCommand instead.
rem ===========================================================================
setlocal
title Cute Fat Fish Pet - setup
cd /d "%~dp0"

set "PS=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
if not exist "%PS%" set "PS=powershell"

rem  Was the whole package extracted? (double-clicking inside the ZIP preview
rem  extracts only this one small file to a temp folder)
set "BROKEN="
if not exist "%~dp0install.ps1" set "BROKEN=1"
if not exist "%~dp0electron\electron.exe" set "BROKEN=1"
if not exist "%~dp0app\package.json" set "BROKEN=1"

if defined BROKEN "%PS%" -NoProfile -ExecutionPolicy Bypass -EncodedCommand JABIAG8AcwB0AC4AVQBJAC4AUgBhAHcAVQBJAC4AVwBpAG4AZABvAHcAVABpAHQAbABlAD0AJwDvUzFyJ1mlgHycTGigWyAALQAgAIlbxYgnAAoAVwByAGkAdABlAC0ASABvAHMAdAAgACcAJwAKAFcAcgBpAHQAZQAtAEgAbwBzAHQAIAAnACAAIABbACEAXQAgAItTKX8FU6FsCWeMW3Rl44mLUxr/2Y8qTodl9k45WcyROn8RXCAAaQBuAHMAdABhAGwAbAAuAHAAcwAxACAAFmIgAGUAbABlAGMAdAByAG8AbgACMCcACgBXAHIAaQB0AGUALQBIAG8AcwB0ACAAJwAnAAoAVwByAGkAdABlAC0ASABvAHMAdAAgACcAIAAgADhewYmfU+BWGv/0dqVjKFeLUyl/BVOEdoSYyImXeuNTzJHMU/tRhk4gAIlbxYguAGMAbQBkACAAFCAUICAAo5A3aCAAVwBpAG4AZABvAHcAcwAgAOpTimLZjwBOKk4nAAoAVwByAGkAdABlAC0ASABvAHMAdAAgACcAIAAgAIdl9k7jiTBSNE72Ze52VV8M/4lbxYgLeo9eDU4aT9+Nx49lZwIwJwAKAFcAcgBpAHQAZQAtAEgAbwBzAHQAIAAnACcACgBXAHIAaQB0AGUALQBIAG8AcwB0ACAAJwAgACAA94vZjzdoWlAI/4xOCZAATgn/Gv8nAAoAVwByAGkAdABlAC0ASABvAHMAdAAgACcAIAAgACAAIAAxAC4AIADzUy6VC059j4R2IAB6AGkAcAAgAJIhDDBoUeiQ44mLUyl/JiANMJIhIADjiYtTMFLtdwBOuXCEdu+NhF8I/4JZIABEADoAXABDAHUAdABlAEYAYQB0AEYAaQBzAGgAUABlAHQACf8M/ycACgBXAHIAaQB0AGUALQBIAG8AcwB0ACAAJwAgACAAIAAgACAAIAAgAG54pIuHZfZOOVnMkQlnIABlAGwAZQBjAHQAcgBvAG4AATBhAHAAcAABMGkAbgBzAHQAYQBsAGwALgBwAHMAMQAM/41RzFP7USAAiVvFiC4AYwBtAGQAAjAnAAoAVwByAGkAdABlAC0ASABvAHMAdAAgACcAIAAgACAAIAAyAC4AIAAWYvR2pWPMU/tRIABzAGUAdAB1AHAALgBlAHgAZQAI/4lbxYgLeo9eDU4odeOJi1MJ/wIwJwAKAFcAcgBpAHQAZQAtAEgAbwBzAHQAIAAnACcACgBXAHIAaQB0AGUALQBIAG8AcwB0ACAAJwAgACAAKABFAG4AZwBsAGkAcwBoACkAIABUAGgAZQAgAFoASQBQACAAdwBhAHMAIABuAG8AdAAgAGUAeAB0AHIAYQBjAHQAZQBkACAAYwBvAG0AcABsAGUAdABlAGwAeQAsACAAcwBvACAAaQBuAHMAdABhAGwAbAAuAHAAcwAxACAAaQBzACAAbQBpAHMAcwBpAG4AZwAgAG4AZQB4AHQAJwAKAFcAcgBpAHQAZQAtAEgAbwBzAHQAIAAnACAAIAB0AG8AIAB0AGgAaQBzACAAZgBpAGwAZQAuACAARQB4AHQAcgBhAGMAdAAgAHQAaABlACAAdwBoAG8AbABlACAAWgBJAFAAIAB0AG8AIABhACAAZgBvAGwAZABlAHIALAAgAHQAaABlAG4AIAByAHUAbgAgAIlbxYguAGMAbQBkACAAYQBnAGEAaQBuAC4AJwAKAFcAcgBpAHQAZQAtAEgAbwBzAHQAIAAnACcACgA=
if defined BROKEN echo.
if defined BROKEN echo   [x] Setup did not start: this folder is missing install.ps1 / electron / app.
if defined BROKEN echo       Please extract the WHOLE zip to a folder first, then run this file again.
if defined BROKEN pause
if defined BROKEN exit /b 1

echo.
echo   Cute Fat Fish Pet - one-click setup
echo   Progress is printed below. This window stays open at the end on purpose.
echo.
"%PS%" -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1" %*
set "RC=%ERRORLEVEL%"
echo.
if not "%RC%"=="0" echo   [x] Setup did not finish. Exit code: %RC%
if not "%RC%"=="0" echo       Scroll up, take a screenshot of this window, and send it back.
if "%RC%"=="0" echo   [ok] Setup finished.
echo.
pause
exit /b %RC%
