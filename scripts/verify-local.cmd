@echo off
setlocal

echo [1/5] Unit tests
call npm test
if errorlevel 1 exit /b 1

echo [2/5] Firefox self-hosted lint
call npm run lint:addon
if errorlevel 1 exit /b 1

echo [3/5] Mozilla/privacy conformity checks
call npm run check:compliance
if errorlevel 1 exit /b 1

echo [4/5] Runtime dependency audit
call npm run audit:runtime
if errorlevel 1 exit /b 1

echo [5/5] Cloudflare dry-run build
call npx wrangler deploy --dry-run --outdir .wrangler-dry-run
if errorlevel 1 exit /b 1

echo.
echo Watch Home local verification PASSED.
exit /b 0
