#!/bin/bash

# Production build script for Selva
# Builds web assets and embeds them into the Grasshopper plugin

set -e  # Exit on error

echo "======================================"
echo "Selva Production Build"
echo "======================================"
echo ""

# Navigate to project root
cd "$(dirname "$0")/.."

# Step 1: Build web application
echo "[1/4] Building web application..."
pnpm --filter @selva/web run build:plugin
echo "✓ Web build complete"
echo ""

# Step 2: Copy web assets to plugin directory
echo "[2/4] Copying web assets to plugin..."
rm -rf Plugin/EmbeddedAssets/web/*
cp -r packages/builder/build/* Plugin/EmbeddedAssets/web/
echo "✓ Web assets copied"
echo ""

# Step 3: Build C# plugin with embedded assets
echo "[3/4] Building C# plugin..."
cd Plugin
dotnet build --configuration Release
echo "✓ Plugin build complete"
echo ""

# Step 4: Display output information
echo "[4/4] Build summary:"
echo ""
echo "Output files:"
echo "  - Rhino 7 (net48):  $(pwd)/bin/Release/net48/Selva.gha"
echo "  - Rhino 8 (net7.0): $(pwd)/bin/Release/net7.0/Selva.gha"
echo ""

# Get file sizes
NET48_SIZE=$(ls -lh bin/Release/net48/Selva.gha | awk '{print $5}')
NET70_SIZE=$(ls -lh bin/Release/net7.0/Selva.gha | awk '{print $5}')

echo "File sizes:"
echo "  - net48:  $NET48_SIZE"
echo "  - net7.0: $NET70_SIZE"
echo ""

echo "======================================"
echo "✓ Production build complete!"
echo "======================================"
echo ""
echo "Next steps:"
echo "  1. Test the plugin by copying to Grasshopper Libraries folder"
echo "  2. Restart Rhino"
echo "  3. Add UIBuilderComponent and enable it"
echo "  4. Browser should open automatically to embedded server"
echo ""
