#!/usr/bin/env node

const { compile } = require('json-schema-to-typescript');
const fs = require('fs');
const path = require('path');

async function main() {
  const schemaPath = path.join(__dirname, 'ui-schema.json');
  const outputPath = path.join(__dirname, '../web/src/lib/types/generated/schema.ts');

  const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));

  // Remove the root $ref that causes issues
  delete schema.$ref;

  try {
    const ts = await compile(schema, 'UISchemaRoot', {
      bannerComment: '/* eslint-disable */\n/**\n * This file was automatically generated from schemas/ui-schema.json.\n * DO NOT MODIFY IT BY HAND. Instead, modify the source JSON Schema file,\n * and run `npm run generate:ts` in the schemas directory to regenerate this file.\n */\n',
      style: {
        singleQuote: true,
      },
      unreachableDefinitions: true,
      strictIndexSignatures: true,
    });

    // Post-process to add type guards and helper types
    let output = ts;

    // Add type guards at the end
    const typeGuards = `

// ============================================================================
// TYPE GUARDS
// ============================================================================

export function isInputLayoutItem(item: LayoutItem): item is InputNumberLayoutItem | InputTextLayoutItem | InputDropdownLayoutItem | InputCheckboxLayoutItem {
  return item.type === 'input';
}

export function isOutputLayoutItem(item: LayoutItem): item is OutputTextLayoutItem | OutputNumberLayoutItem {
  return item.type === 'output';
}

export function isNumberWidget(item: LayoutItem): item is InputNumberLayoutItem {
  return item.type === 'input' && item.widgetType === 'number';
}

export function isTextWidget(item: LayoutItem): item is InputTextLayoutItem {
  return item.type === 'input' && item.widgetType === 'text';
}

export function isDropdownWidget(item: LayoutItem): item is InputDropdownLayoutItem {
  return item.type === 'input' && item.widgetType === 'dropdown';
}

export function isCheckboxWidget(item: LayoutItem): item is InputCheckboxLayoutItem {
  return item.type === 'input' && item.widgetType === 'checkbox';
}

// Helper type aliases
export type InputLayoutItem = InputNumberLayoutItem | InputTextLayoutItem | InputDropdownLayoutItem | InputCheckboxLayoutItem;
export type OutputLayoutItem = OutputTextLayoutItem | OutputNumberLayoutItem;
export type SupportedTypes = string | number | boolean;
`;

    output += typeGuards;

    // Ensure output directory exists
    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    fs.writeFileSync(outputPath, output);
    console.log(`Generated TypeScript types at: ${outputPath}`);
  } catch (error) {
    console.error('Error generating TypeScript:', error);
    process.exit(1);
  }
}

main();
