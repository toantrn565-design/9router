@echo off
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows\Install-RouterBoard.ps1"
if errorlevel 1 pause
