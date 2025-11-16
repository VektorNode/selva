# ComputeBuilder Development Startup Script
# This script builds the plugin and starts the web server

Write-Host "==================================" -ForegroundColor Cyan
Write-Host "ComputeBuilder Development Setup" -ForegroundColor Cyan
Write-Host "==================================" -ForegroundColor Cyan
Write-Host ""

# Step 1: Build the plugin
Write-Host "[1/3] Building Grasshopper plugin..." -ForegroundColor Yellow
dotnet build --configuration Debug

if ($LASTEXITCODE -ne 0) {
    Write-Host "Build failed! Please fix errors and try again." -ForegroundColor Red
    exit 1
}

Write-Host "✓ Build successful!" -ForegroundColor Green
Write-Host ""

# Step 2: Show installation instructions
Write-Host "[2/3] Plugin Installation" -ForegroundColor Yellow
Write-Host "Copy the .gha file to Grasshopper:" -ForegroundColor White
Write-Host ""
Write-Host "For Rhino 7:" -ForegroundColor Gray
Write-Host "  copy `"bin\Debug\net48\ComputeBuilder.gha`" `"%APPDATA%\Grasshopper\Libraries\`"" -ForegroundColor Gray
Write-Host ""
Write-Host "For Rhino 8:" -ForegroundColor Gray
Write-Host "  copy `"bin\Debug\net7.0\ComputeBuilder.gha`" `"%APPDATA%\Grasshopper\Libraries-8\`"" -ForegroundColor Gray
Write-Host ""

$install = Read-Host "Install now? (7/8/N)"
if ($install -eq "7") {
    Copy-Item "bin\Debug\net48\ComputeBuilder.gha" "$env:APPDATA\Grasshopper\Libraries\" -Force
    Write-Host "✓ Installed to Rhino 7!" -ForegroundColor Green
} elseif ($install -eq "8") {
    Copy-Item "bin\Debug\net7.0\ComputeBuilder.gha" "$env:APPDATA\Grasshopper\Libraries-8\" -Force
    Write-Host "✓ Installed to Rhino 8!" -ForegroundColor Green
} else {
    Write-Host "Skipped installation. Copy manually when ready." -ForegroundColor Yellow
}

Write-Host ""

# Step 3: Start web server
Write-Host "[3/3] Starting SvelteKit development server..." -ForegroundColor Yellow
Write-Host ""
Write-Host "The web UI will be available at: http://localhost:5173" -ForegroundColor Cyan
Write-Host ""
Write-Host "Press Ctrl+C to stop the server when done." -ForegroundColor Gray
Write-Host ""

Set-Location web
npm run dev
