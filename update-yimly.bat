@echo off
setlocal enabledelayedexpansion

title Yimly - Update

echo ========================================
echo         YIMLY UPDATE
echo ========================================
echo.

:: Step 1: Change to script directory
cd /d "%~dp0"

:: [1/5] Checking repository...
echo [1/5] Checking repository...
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

:: [2/5] Pulling latest GitHub changes...
echo [2/5] Pulling latest GitHub changes...
git pull
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Failed to pull changes from remote GitHub repository.
    echo Please check your network connection and Git credentials.
    echo.
    pause
    exit /b 1
)
echo.

:: [3/5] Rebuilding Docker image...
echo [3/5] Rebuilding Docker image...
docker compose build --pull
if %ERRORLEVEL% neq 0 (
    echo [WARNING] Build with --pull had a notice, attempting standard build...
    docker compose build
    if %ERRORLEVEL% neq 0 (
        echo [ERROR] Docker image build failed.
        echo Review the error messages above for details.
        echo.
        pause
        exit /b 1
    )
)
echo.

:: [4/5] Restarting Yimly...
echo [4/5] Restarting Yimly...
:: Recreate containers without destroying data volumes
docker compose up -d
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

:: [5/5] Checking health...
echo [5/5] Checking health...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "$attempts = 0; $max = 30; $healthy = $false;" ^
    "Write-Host 'Waiting for Yimly to respond...';" ^
    "while ($attempts -lt $max) {" ^
    "  try {" ^
    "    $res = Invoke-RestMethod -Uri 'http://localhost:3000/health' -TimeoutSec 2 -ErrorAction Stop;" ^
    "    if ($res.status -eq 'ok') { $healthy = $true; break }" ^
    "  } catch {}" ^
    "  Start-Sleep -Seconds 1;" ^
    "  $attempts++;" ^
    "}" ^
    "if ($healthy) {" ^
    "  Write-Host 'Health check passed: Yimly is healthy and online.' -ForegroundColor Green;" ^
    "  exit 0;" ^
    "} else {" ^
    "  Write-Host 'Service is running but health check timed out. Check container logs.' -ForegroundColor Yellow;" ^
    "  exit 0;" ^
    "}"

echo.
echo ========================================
echo Yimly update complete.
echo ========================================
echo.
docker compose ps
echo.
echo Yimly is accessible at: http://localhost:3000
echo.
pause
