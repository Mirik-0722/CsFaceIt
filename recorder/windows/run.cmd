@echo off
rem Runs the recorder with the env file given as the only argument, and starts it again a minute after it stops with an
rem error. What it writes goes to logs\recorder-<date>.log in the recorder's folder, one file per day of a start.
rem install.ps1 registers it to start at sign-in; by hand: windows\run.cmd C:\csfaceit\recorder.env
setlocal
if "%~1"=="" (
  echo Usage: run.cmd ^<env file^>
  exit /b 2
)
title CsFaceIt recorder
cd /d "%~dp0.."
if not exist logs mkdir logs

:start
for /f %%d in ('powershell -NoProfile -Command "Get-Date -Format yyyy-MM-dd"') do set "TODAY=%%d"
echo %DATE% %TIME% The recorder runs; its log is %CD%\logs\recorder-%TODAY%.log
node --env-file="%~1" dist\main.js >> "logs\recorder-%TODAY%.log" 2>&1
set "CODE=%ERRORLEVEL%"
rem 0: it was asked to stop (Ctrl+C). 2: it cannot start, and says why in the log: put the env file right and start
rem the task again. Anything else is a crash: start again after a minute.
if "%CODE%"=="0" exit /b 0
if "%CODE%"=="2" (
  echo The recorder cannot start: the reason is at the end of logs\recorder-%TODAY%.log
  exit /b 2
)
echo %DATE% %TIME% The recorder stopped with code %CODE%; it starts again in a minute.
ping -n 61 127.0.0.1 >nul
goto start
