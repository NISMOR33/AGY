@echo off
chcp 65001 >nul
title agy console v2.0 (Local + Wi-Fi + 4G/5G)
cd /d "%~dp0"
if not exist "node_modules" (
  echo Installation des dependances...
  call npm install
)
node server.js
pause

