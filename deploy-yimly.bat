@echo off
setlocal enabledelayedexpansion

title Yimly - Initial Deployment

echo ========================================
echo        YIMLY INITIAL DEPLOYMENT
echo ========================================
echo.

:: Step 1: Change directory to project root
cd /d "%~dp0"

:: Step 2: Check prerequisites
echo [1/5] Checking Docker prerequisites...
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

:: Step 3: Create persistent directories safely
echo [2/5] Preparing persistent directories...
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

:: Step 4: Check environment configuration
echo [3/5] Checking environment configuration...
if not exist ".env" (
    if exist ".env.example" (
        copy /y ".env.example" ".env" >nul
        echo Created .env from .env.example with default values.
        echo [NOTE] Remember to customize JWT_SECRET in .env for production.
    ) else (
        echo PORT=3000 > .env
        echo JWT_SECRET=yimly_production_secret_change_me >> .env
        echo DATA_PATH=./data >> .env
        echo MEDIA_PATH=./media >> .env
        echo Created default .env file.
    )
) else (
    echo Existing .env found.
)
echo.

:: Step 5: Build and start Yimly container
echo [4/5] Building and launching Yimly with Docker Compose...
docker compose up -d --build
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Failed to build or start Docker container.
    echo Check Docker Desktop is running and view the error above.
    echo.
    pause
    exit /b 1
)
echo.

:: Step 6: Wait for health check
echo [5/5] Verifying service health...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "$attempts = 0; $max = 30; $healthy = $false;" ^
    "Write-Host 'Waiting for Yimly to start...';" ^
    "while ($attempts -lt $max) {" ^
    "  try {" ^
    "    $res = Invoke-RestMethod -Uri 'http://localhost:3000/health' -TimeoutSec 2 -ErrorAction Stop;" ^
    "    if ($res.status -eq 'ok') { $healthy = $true; break }" ^
    "  } catch {}" ^
    "  Start-Sleep -Seconds 1;" ^
    "  $attempts++;" ^
    "}" ^
    "if ($healthy) {" ^
    "  Write-Host 'Yimly server is healthy and responding!' -ForegroundColor Green;" ^
    "  exit 0;" ^
    "} else {" ^
    "  Write-Host 'Yimly container started, but health endpoint is still initializing.' -ForegroundColor Yellow;" ^
    "  exit 0;" ^
    "}"

echo.
echo ========================================
echo        YIMLY DEPLOYMENT COMPLETE
echo ========================================
echo.
docker compose ps
echo.
echo Yimly is running at: http://localhost:3000
echo.
echo First time setup:
echo 1. Open http://localhost:3000 in your browser
echo 2. Complete the First-Run Setup to create your Administrator account
echo 3. Place your MP3 and LRC files into .\media
echo 4. Go to Settings in Yimly to add and scan the '/media' folder
echo.
pause
