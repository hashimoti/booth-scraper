# build.ps1

# 1. Check for main.key
if (Test-Path ".\main.key") {
    $key = Get-Content -Path ".\main.key" -Raw
    Write-Host "Success: main.key loaded." -ForegroundColor Green
} else {
    Write-Host "Error: main.key not found!" -ForegroundColor Red
    exit 1
}

# 2. Set Env variables
$env:TAURI_SIGNING_PRIVATE_KEY = $key
$env:TAURI_SIGNING_PASSWORD = ""

# 3. Build
Write-Host "Starting Signed Build..." -ForegroundColor Cyan
npx tauri build

Write-Host "Build Finished!" -ForegroundColor Green