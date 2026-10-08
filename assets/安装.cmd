@echo off
chcp 65001 >nul
title BlueHairMaid - setup
echo.
echo   蓝毛小女仆 - 一键安装
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1" %*
if errorlevel 1 (
  echo.
  echo   [安装没成功] 上面有原因。按任意键关闭。
  pause >nul
)
