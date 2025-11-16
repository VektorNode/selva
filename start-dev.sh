#!/bin/bash
# ComputeBuilder Development Startup Script (macOS/Linux)
# This script builds the plugin and starts the web server

echo "=================================="
echo "ComputeBuilder Development Setup"
echo "=================================="
echo ""

# Step 1: Build the plugin
echo "[1/3] Building Grasshopper plugin..."
dotnet build --configuration Debug

if [ $? -ne 0 ]; then
    echo "❌ Build failed! Please fix errors and try again."
    exit 1
fi

echo "✓ Build successful!"
echo ""

# Step 2: Show installation instructions
echo "[2/3] Plugin Installation"
echo "Copy the .gha file to Grasshopper:"
echo ""
echo "For Rhino 8 (macOS):"
echo "  cp bin/Debug/net7.0/ComputeBuilder.gha ~/Library/Application\ Support/McNeel/Rhinoceros/8.0/Plug-ins/Grasshopper/Libraries/"
echo ""

read -p "Install now? (y/N): " install
if [ "$install" = "y" ] || [ "$install" = "Y" ]; then
    mkdir -p ~/Library/Application\ Support/McNeel/Rhinoceros/8.0/Plug-ins/Grasshopper/Libraries/
    cp bin/Debug/net7.0/ComputeBuilder.gha ~/Library/Application\ Support/McNeel/Rhinoceros/8.0/Plug-ins/Grasshopper/Libraries/
    echo "✓ Installed to Rhino 8!"
else
    echo "Skipped installation. Copy manually when ready."
fi

echo ""

# Step 3: Start web server
echo "[3/3] Starting SvelteKit development server..."
echo ""
echo "The web UI will be available at: http://localhost:5173"
echo ""
echo "Press Ctrl+C to stop the server when done."
echo ""

cd web
npm run dev
