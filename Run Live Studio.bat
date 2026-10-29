@echo off
title Live Studio
cd /d "%~dp0"
where node >/dev/null 2>/dev/null || (echo Node.js is not installed. Get the LTS version from https://nodejs.org and run this again. & pause & exit /b)
if not exist node_modules (
  echo First run: downloading the app parts. This takes a few minutes...
  call npm install || (echo Install failed. & pause & exit /b)
)
call npm start
