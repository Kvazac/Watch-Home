@echo off
setlocal

curl --fail --silent --show-error https://watch-home.ugnius-socials.workers.dev/health
if errorlevel 1 exit /b 1

echo.
echo Worker health check PASSED.
exit /b 0
