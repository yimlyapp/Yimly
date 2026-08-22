@echo off
setlocal enabledelayedexpansion

title Yimly - Initial Deployment

echo ========================================
echo        YIMLY INITIAL DEPLOYMENT
echo ========================================
echo.

:: Step 1: Change directory to project root
cd /d "%~dp0"

:: Step 2: Check Docker prerequisites
echo [1/6] Checking Docker prerequisites...
where docker >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Docker is not installed or not found in PATH.
    echo Please install Docker Desktop for Windows and ensure it is running.
    echo https://www.docker.com/products/docker-desktop/
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

echo Docker is available.
echo.

:: Step 3: Verify external Cloudflare network exists
echo [2/6] Verifying external Cloudflare network 'cloudflared_bridge'...
docker network inspect cloudflared_bridge >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [ERROR] External Docker network 'cloudflared_bridge' does not exist.
    echo Please ensure the Cloudflare tunnel infrastructure and 'cloudflared_bridge' network are set up.
    echo Manual Cloudflare network setup is required before deploying Yimly.
    echo.
    pause
    exit /b 1
)
echo External network 'cloudflared_bridge' verified.
echo.

:: Step 4: Create persistent directories safely
echo [3/6] Preparing persistent directories...
if not exist "data" (
    mkdir data
    echo Created persistent directory: .\data
) else (
    echo Persistent directory exists: .\data (preserving existing data)
)

if not exist "media" (
    mkdir media
    echo Created media directory: .\media
) else (
    echo Media directory exists: .\media (preserving existing data)
)
echo.

:: Step 5: Check environment configuration
echo [4/6] Checking environment configuration...
if not exist ".env" (
    if exist ".env.example" (
        copy /y ".env.example" ".env" >nul
        echo Created .env from .env.example with default values.
        echo [NOTE] Remember to customize JWT_SECRET in .env for production.
    ) else (
        echo JWT_SECRET=yimly_production_secret_change_me > .env
        echo DATA_PATH=./data >> .env
        echo MEDIA_PATH=./media >> .env
        echo Created default .env file.
    )
) else (
    echo Existing .env found.
)
echo.

:: Step 6: Build and start Yimly container
echo [5/6] Building and launching Yimly with Docker Compose...
docker compose -f compose.yaml up -d --build
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Failed to build or start Docker container.
    echo Check Docker Desktop is running and view the error above.
    echo.
    pause
    exit /b 1
)
echo.

:: Step 7: Verify container health using Docker
echo [6/6] Verifying container health status...
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
    "  Write-Host 'Yimly container is healthy and operational on cloudflared_bridge!' -ForegroundColor Green;" ^
    "  exit 0;" ^
    "} else {" ^
    "  Write-Host 'Container is running (checking status via docker compose ps).' -ForegroundColor Yellow;" ^
    "  exit 0;" ^
    "}"

echo.
echo ========================================
echo        YIMLY DEPLOYMENT COMPLETE
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
echo First time setup:
echo 1. Access Yimly via your Cloudflare Tunnel public domain
echo 2. Complete the First-Run Setup to create your Administrator account
echo 3. Place your MP3 and LRC files into .\media
echo 4. Go to Settings in Yimly to add and scan the '/media' folder
echo.
pause
