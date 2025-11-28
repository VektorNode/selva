#!/bin/bash

# Install script for macOS (Rhino 8)
# Copies the built plugin to the Grasshopper Libraries folder

set -e

echo "======================================"
echo "Selva - Install to Rhino 8 (macOS)"
echo "======================================"
echo ""

# Navigate to project root
cd "$(dirname "$0")/.."

SOURCE_FILE="Plugin/bin/Release/net7.0/Selva.gha"
DEST_DIR="$HOME/Library/Application Support/McNeel/Rhinoceros/8.0/Plug-ins/Grasshopper/Libraries"

# Check if source file exists
if [ ! -f "$SOURCE_FILE" ]; then
  echo "Error: Plugin not found at $SOURCE_FILE"
  echo "Please run ./scripts/build-production.sh first"
  exit 1
fi

# Create destination directory if it doesn't exist
mkdir -p "$DEST_DIR"

# Copy the plugin
echo "Copying $SOURCE_FILE"
echo "     to $DEST_DIR"
cp "$SOURCE_FILE" "$DEST_DIR/"

echo ""
echo "✓ Installation complete!"
echo ""
echo "Next steps:"
echo "  1. Restart Rhino 8 completely"
echo "  2. Open Grasshopper"
echo "  3. Add 'UI Builder' component from Selva > Core tab"
echo "  4. Enable the component"
echo ""
