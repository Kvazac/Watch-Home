@echo off
setlocal

if "%~1"=="" (
  echo Usage: scripts\release-preflight.cmd 1.1.0
  exit /b 2
)

echo Verifying release version %~1...
call node scripts\verify-release.mjs %~1
if errorlevel 1 exit /b 1

call scripts\verify-local.cmd
if errorlevel 1 exit /b 1

echo.
echo Release %~1 preflight PASSED.
exit /b 0
