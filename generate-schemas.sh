#!/bin/bash

# Generate types from JSON Schema
# Run this after modifying schemas/ui-schema.json

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCHEMAS_DIR="$SCRIPT_DIR/schemas"

echo "Generating types from JSON Schema..."

cd "$SCHEMAS_DIR"

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
    echo "Installing schema generator dependencies..."
    npm install
fi

# Generate all types
npm run generate:all

echo ""
echo "Generation complete!"
echo "  - TypeScript: web/src/lib/types/generated/schema.ts"
echo "  - C#: Plugin/Models/Generated/UISchema.Generated.cs"
echo ""
echo "Remember to rebuild after regenerating:"
echo "  - Run 'npm run check' in web/ to verify TypeScript"
echo "  - Run 'dotnet build' to verify C#"
