@echo off
chcp 65001 >nul
title BlueHairMaid - uninstall
echo.
echo   蓝毛小女仆 - 卸载
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0uninstall.ps1" %*
pause >nul
