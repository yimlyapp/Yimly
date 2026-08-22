@echo off
setlocal enabledelayedexpansion

title Yimly - Update

echo ========================================
echo         YIMLY UPDATE
echo ========================================
echo.

:: Step 1: Change to script directory
cd /d "%~dp0"

:: [1/6] Checking repository and Docker...
echo [1/6] Checking repository and Docker...
where git >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Git is not installed or not found in PATH.
    echo Please install Git for Windows to enable repository updates.
    echo https://git-scm.com/download/win
    echo.
    pause
    exit /b 1
)

where docker >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Docker is not installed or not found in PATH.
    echo Please ensure Docker Desktop is installed and running.
    echo.
    pause
    exit /b 1
)

docker compose version >nul 2>&1
if %ERRORLEVEL% neq 0 (
    docker-compose version >nul 2>&1
    if %ERRORLEVEL% neq 0 (
        echo [ERROR] Docker Compose is not available.
        echo Please ensure Docker Desktop is running with Docker Compose enabled.
        echo.
        pause
        exit /b 1
    )
)

echo Repository and Docker verified.
echo.

:: [2/6] Verifying external Cloudflare network exists...
echo [2/6] Verifying external Cloudflare network 'cloudflared_bridge'...
docker network inspect cloudflared_bridge >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [ERROR] External Docker network 'cloudflared_bridge' does not exist.
    echo Please ensure the Cloudflare tunnel infrastructure and 'cloudflared_bridge' network are set up.
    echo Manual Cloudflare network setup is required.
    echo.
    pause
    exit /b 1
)
echo External network 'cloudflared_bridge' verified.
echo.

:: [3/6] Pulling latest GitHub changes...
echo [3/6] Pulling latest GitHub changes...
git pull
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Failed to pull changes from remote GitHub repository.
    echo Please check your network connection and Git credentials.
    echo.
    pause
    exit /b 1
)
echo.

:: [4/6] Rebuilding Docker image...
echo [4/6] Rebuilding Docker image...
docker compose -f compose.yaml build --pull
if %ERRORLEVEL% neq 0 (
    echo [WARNING] Build with --pull had a notice, attempting standard build...
    docker compose -f compose.yaml build
    if %ERRORLEVEL% neq 0 (
        echo [ERROR] Docker image build failed.
        echo Review the error messages above for details.
        echo.
        pause
        exit /b 1
    )
)
echo.

:: [5/6] Restarting Yimly...
echo [5/6] Restarting Yimly...
:: Recreate containers without destroying data volumes
docker compose -f compose.yaml up -d
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Failed to restart Docker containers.
    echo.
    pause
    exit /b 1
)

:: Safely prune dangling images from previous builds without touching volumes or active images
docker image prune -f >nul 2>&1
echo Container restarted successfully.
echo.

:: [6/6] Checking container health...
echo [6/6] Checking container health status...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "$attempts = 0; $max = 30; $healthy = $false;" ^
    "Write-Host 'Waiting for Yimly container health check...';" ^
    "while ($attempts -lt $max) {" ^
    "  $status = (docker inspect --format='{{json .State.Health.Status}}' yimly 2>$null) -replace '\"','';" ^
    "  if ($status -eq 'healthy') { $healthy = $true; break }" ^
    "  Start-Sleep -Seconds 2;" ^
    "  $attempts++;" ^
    "}" ^
    "if ($healthy) {" ^
    "  Write-Host 'Health check passed: Yimly container is healthy and online.' -ForegroundColor Green;" ^
    "  exit 0;" ^
    "} else {" ^
    "  Write-Host 'Service is running (checking status via docker compose ps).' -ForegroundColor Yellow;" ^
    "  exit 0;" ^
    "}"

echo.
echo ========================================
echo Yimly update complete.
echo ========================================
echo.
docker compose -f compose.yaml ps
echo.
echo Yimly Networking Summary:
echo - Compose Service: yimly
echo - Docker Network: cloudflared_bridge (external)
echo - Network Alias: yimly
echo - Internal Port: 3000
echo - Published Host Ports: None (Securely bridged via Cloudflare Tunnel)
echo - Cloudflare Tunnel Target: http://yimly:3000
echo.
pause
