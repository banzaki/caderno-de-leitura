@echo off
title Caderno de Leitura
cd /d "%~dp0"
if not exist node_modules (
  echo First run: installing the reader libraries...
  call npm install
)
echo Starting Caderno de Leitura. Keep this window open while you read; close it to stop the app.
node server.js --open
if errorlevel 1 pause
