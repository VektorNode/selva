import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageRoot = path.join(__dirname, '..');
const repoRoot = path.join(packageRoot, '..', '..');

const schemaPath = path.join(packageRoot, 'ui-schema.json');
const outputPath = path.join(repoRoot, 'Plugin/Selva.Schema/Models/UISchema.Generated.cs');

const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
const definitions = schema.definitions;

// ============================================================================
// VERSION GUARD
// Compares definitions against the last committed version.
// Errors if definitions changed but schemaVersion was not bumped.
// ============================================================================
checkSchemaVersionBumped();

function checkSchemaVersionBumped() {
  // Canonicalise definitions for comparison: strip comment keys and the
  // schemaVersion default (which is the field being bumped) so we don't
  // false-positive on the version bump itself.
  function canonicalise(schemaObj) {
    const defs = { ...schemaObj.definitions };
    // Strip comment pseudo-keys
    for (const key of Object.keys(defs)) {
      if (key.startsWith('//_')) delete defs[key];
    }
    // Exclude the schemaVersion default from the comparison so bumping the
    // version alone does not count as a definitions change.
    if (defs.UISchema?.properties?.schemaVersion) {
      defs.UISchema = JSON.parse(JSON.stringify(defs.UISchema));
      delete defs.UISchema.properties.schemaVersion.default;
    }
    return JSON.stringify(defs, Object.keys(defs).sort());
  }

  let committedSchemaStr;
  try {
    committedSchemaStr = execSync('git show HEAD:packages/schemas/ui-schema.json', {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch {
    // Not a git repo or no commits yet — skip the check
    return;
  }

  const committedSchema = JSON.parse(committedSchemaStr);
  const committedVersion = committedSchema.definitions?.UISchema?.properties?.schemaVersion?.default ?? '0.0.0';
  const workingVersion = schema.definitions?.UISchema?.properties?.schemaVersion?.default ?? '0.0.0';

  const committedDefs = canonicalise(committedSchema);
  const workingDefs = canonicalise(schema);

  if (committedDefs !== workingDefs && committedVersion === workingVersion) {
    console.error('');
    console.error('  ERROR: Schema definitions changed but schemaVersion was not bumped.');
    console.error(`  Current version: ${workingVersion}`);
    console.error('');
    console.error('  Update "schemaVersion" default in UISchema (e.g. 2.3.0 → 2.4.0),');
    console.error('  add a migration entry in SchemaMigrator.cs, and update packages/schemas/CHANGELOG.md.');
    console.error('');
    process.exit(1);
  }

  if (committedDefs !== workingDefs) {
    console.log(`  Version bumped: ${committedVersion} → ${workingVersion}`);
  }
}

// String-enum types that are represented as plain 'string' in C# for compatibility.
// Add new string-enum definition names here when they are introduced in the schema.
const STRING_ALIAS_TYPES = new Set(['GrasshopperParamType', 'GrasshopperInputStructure']);

// Helper to resolve properties from allOf inheritance
function resolveDefinition(def) {
  let properties = {};
  let required = [];

  if (def.properties) {
    properties = { ...def.properties };
  }
  if (def.required) {
    required = [...def.required];
  }

  if (def.allOf) {
    for (const item of def.allOf) {
      if (item.$ref) {
        const refName = item.$ref.replace('#/definitions/', '');
        const refDef = definitions[refName];
        if (refDef) {
          const resolved = resolveDefinition(refDef);
          Object.assign(properties, resolved.properties);
          required = [...required, ...resolved.required];
        }
      } else {
        // Inline object in allOf
        if (item.properties) {
          Object.assign(properties, item.properties);
        }
        if (item.required) {
          required = [...required, ...item.required];
        }
      }
    }
  }

  return { properties, required };
}

// Type mappings from JSON Schema to C#
function jsonTypeToCSharp(prop, propName, required) {
  if (!prop) return 'object';

  if (prop.$ref) {
    const refName = prop.$ref.replace('#/definitions/', '');
    // String-enum types are represented as 'string' in C# for compatibility
    if (STRING_ALIAS_TYPES.has(refName)) {
      return 'string';
    }
    // LayoutItem is a discriminated union - use the base class
    if (Object.keys(discriminatedUnions).includes(refName)) {
      return `${refName}Base`;
    }
    return refName;
  }

  if (prop.const) {
    return 'string';
  }

  if (prop.enum) {
    // Use string for all enums for compatibility
    return 'string';
  }

  switch (prop.type) {
    case 'string':
      if (prop.format === 'date-time') return 'DateTime';
      // Check for GUID descriptions (Grasshopper uses GUIDs extensively)
      if (prop.description && prop.description.toLowerCase().includes('guid')) {
        return 'Guid';
      }
      return 'string';
    case 'number':
      return required ? 'double' : 'double?';
    case 'integer':
      return required ? 'int' : 'int?';
    case 'boolean':
      return required ? 'bool' : 'bool?';
    case 'array':
      const itemType = jsonTypeToCSharp(prop.items, propName, true);
      return `List<${itemType}>`;
    case 'object':
      if (prop.additionalProperties) {
        return 'Dictionary<string, object>';
      }
      return 'object';
    default:
      return 'object';
  }
}

function pascalCase(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function generateProperty(name, prop, required) {
  const csharpType = jsonTypeToCSharp(prop, name, required);
  const pascalName = pascalCase(name);

  // Build JSON property attributes
  const attributes = [];

  // Add NullValueHandling.Ignore for optional properties
  if (
    !required &&
    csharpType !== 'string' &&
    !csharpType.endsWith('?') &&
    !csharpType.startsWith('List') &&
    !csharpType.startsWith('Dictionary')
  ) {
    attributes.push('NullValueHandling = NullValueHandling.Ignore');
  }

  // Add DefaultValueHandling.Ignore for properties with defaults
  if (prop.default !== undefined) {
    attributes.push('DefaultValueHandling = DefaultValueHandling.Ignore');
  }

  const attributeString = attributes.length > 0 ? ', ' + attributes.join(', ') : '';

  // GUID-typed fields: the web UI emits "" for an unset GUID, which a plain System.Guid cannot
  // deserialize. Route every Guid property through TolerantGuidConverter ("" / null → Guid.Empty).
  const converterAttr =
    csharpType === 'Guid' ? '\n        [JsonConverter(typeof(TolerantGuidConverter))]' : '';

  let defaultValue = '';
  // Special handling for schemaVersion - use centralized constant
  if (name === 'schemaVersion' && prop.default !== undefined) {
    defaultValue = ' = Constants.SchemaVersion.CURRENT_STRING;';
  } else if (prop.default !== undefined) {
    if (typeof prop.default === 'string') {
      defaultValue = ` = "${prop.default}";`;
    } else if (typeof prop.default === 'boolean') {
      defaultValue = ` = ${prop.default};`;
    } else if (typeof prop.default === 'number') {
      defaultValue = ` = ${prop.default};`;
    }
  } else if (csharpType.startsWith('List<')) {
    defaultValue = ` = new ${csharpType}();`;
  } else if (csharpType === 'DateTime') {
    defaultValue = ' = DateTime.UtcNow;';
  }

  const description = prop.description
    ? `\n/// <summary>\n/// ${prop.description}\n/// </summary>`
    : '';

  return `${description}
        [JsonProperty("${name}"${attributeString})]${converterAttr}
        public ${csharpType} ${pascalName} { get; set; }${defaultValue}`;
}

function generateClass(name, def) {
  // Skip if not an object type
  if (def.type !== 'object' && !def.properties && !def.allOf) return '';

  const { properties, required } = resolveDefinition(def);

  const props = properties
    ? Object.entries(properties)
        .map(([propName, prop]) => generateProperty(propName, prop, required.includes(propName)))
        .join('\n')
    : '';

  const propsSection = props ? `\n${props}\n` : '\n';

  return `    public class ${name}
    {${propsSection}    }`;
}

// ============================================================================
// AUTO-DETECT DISCRIMINATED UNIONS
// ============================================================================

/**
 * Detects discriminated unions in the schema by looking for oneOf patterns
 * Returns a map of union names to their configuration
 */
function detectDiscriminatedUnions() {
  const unions = {};

  for (const [name, def] of Object.entries(definitions)) {
    if (def.oneOf && Array.isArray(def.oneOf)) {
      const variants = def.oneOf
        .filter((item) => item.$ref)
        .map((item) => item.$ref.replace('#/definitions/', ''));

      if (variants.length > 0) {
        // Detect discriminator fields by finding const properties in variants
        const firstVariant = definitions[variants[0]];
        const discriminators = [];

        const firstResolved = resolveDefinition(firstVariant);

        if (firstResolved.properties) {
          for (const [propName, propDef] of Object.entries(firstResolved.properties)) {
            if (propDef.const) {
              discriminators.push(propName);
            }
          }
        }

        // Find common properties across all variants (for base class)
        const commonProps = new Set();
        if (variants.length > 0) {
          const firstProps = Object.keys(firstResolved.properties || {});
          firstProps.forEach((prop) => {
            const isCommon = variants.every(
              (v) => resolveDefinition(definitions[v]).properties?.[prop] !== undefined
            );
            if (isCommon) {
              commonProps.add(prop);
            }
          });
        }

        unions[name] = {
          variants,
          discriminators,
          commonProps: Array.from(commonProps),
          baseClassName: `${name}Base`,
        };
      }
    }
  }

  return unions;
}

const discriminatedUnions = detectDiscriminatedUnions();

// Generate enum from string enum definition
function generateEnum(name, def) {
  if (!def.enum) return '';

  const values = def.enum.map((val) => `${val}`).join(',\n');
  const description = def.description
    ? `\n/// <summary>\n/// ${def.description}\n/// </summary>`
    : '';

  return `${description}
    public enum ${name}
    {
${values}
    }`;
}

// Generate the C# file
let output = `// <auto-generated>
// This file was automatically generated from schemas/ui-schema.json.
// DO NOT MODIFY IT BY HAND. Instead, modify the source JSON Schema file,
// and run the schema generator to regenerate this file.
// </auto-generated>

using System;
using System.Collections.Generic;
using System.Linq;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace Selva.Schema.Models
{
`;

// Generate constants section
if (schema.constants) {
  output += `// ============================================================================
    // CONSTANTS (from schema)
    // ============================================================================

`;
  for (const [key, value] of Object.entries(schema.constants)) {
    const pascalName = pascalCase(key);
    if (Array.isArray(value)) {
      const arrayType = typeof value[0] === 'string' ? 'string' : 'object';
      const formattedValues = value.map(v =>
        typeof v === 'string' ? `"${v}"` : JSON.stringify(v)
      ).join(', ');
      output += `    public static class ${pascalName}
    {
        public static readonly ${arrayType}[] Values = new ${arrayType}[] { ${formattedValues} };
    }

`;
    }
  }
}

// Generate type aliases section
output += `// ============================================================================
    // TYPE ALIASES
    // ============================================================================

    // String-enum types are represented as 'string' in C# for compatibility
    // GrasshopperParamType valid values: ${definitions.GrasshopperParamType?.enum?.map((v) => `"${v}"`).join(', ') || 'N/A'}
    // GrasshopperInputStructure valid values: ${definitions.GrasshopperInputStructure?.enum?.map((v) => `"${v}"`).join(', ') || 'N/A'}

`;

// ============================================================================
// CLASSIFY TYPES FOR ORGANIZATION
// ============================================================================

/**
 * Get all variant class names from all discriminated unions
 */
function getAllUnionVariants() {
  const variants = new Set();
  Object.values(discriminatedUnions).forEach((union) => {
    union.variants.forEach((v) => variants.add(v));
  });
  return variants;
}

/**
 * Dynamically group classes by patterns and naming conventions
 */
function classifySections() {
  const allUnionVariants = getAllUnionVariants();
  const unionNames = Object.keys(discriminatedUnions);

  const sections = {
    UISchema: [],
    'PARAMETER SCHEMAS': [],
    'WIDGET CONFIGURATIONS': [],
    'LAYOUT CONFIGURATION': [],
    'RUNTIME DATA': [],
    'AVAILABLE PARAMETERS': [],
  };

  for (const [name, def] of Object.entries(definitions)) {
    // Skip unions themselves, their variants, enums, and special types
    if (
      unionNames.includes(name) ||
      allUnionVariants.has(name) ||
      def.enum ||
      STRING_ALIAS_TYPES.has(name)
    ) {
      continue;
    }

    // Classify by naming patterns
    if (name === 'UISchema') {
      sections['UISchema'].push(name);
    } else if (
      name.includes('ParamSchema') ||
      (name.includes('Param') && name.includes('Schema'))
    ) {
      sections['PARAMETER SCHEMAS'].push(name);
    } else if (name.endsWith('WidgetConfig')) {
      sections['WIDGET CONFIGURATIONS'].push(name);
    } else if (name.includes('Group') || name.includes('Tab') || name.includes('Layout')) {
      sections['LAYOUT CONFIGURATION'].push(name);
    } else if (name.includes('Runtime') || name.includes('Session') || name.includes('State')) {
      sections['RUNTIME DATA'].push(name);
    } else if (name.includes('Available') || name.includes('Parameters')) {
      sections['AVAILABLE PARAMETERS'].push(name);
    } else {
      // Default to RUNTIME DATA for uncategorized types
      sections['RUNTIME DATA'].push(name);
    }
  }

  return sections;
}

// Generate regular classes (non-union items)
const allUnionVariants = getAllUnionVariants();
const unionBaseClasses = Object.values(discriminatedUnions).map((u) => u.baseClassName);

const regularClasses = Object.entries(definitions)
  .filter(
    ([name]) =>
      !Object.keys(discriminatedUnions).includes(name) &&
      !STRING_ALIAS_TYPES.has(name) &&
      !allUnionVariants.has(name) &&
      !unionBaseClasses.includes(name)
  )
  .map(([name, def]) => {
    if (def.enum) {
      return generateEnum(name, def);
    }
    return generateClass(name, def);
  })
  .filter((cls) => cls);

// Group classes by section
const sections = classifySections();

for (const [sectionName, classNames] of Object.entries(sections)) {
  const sectionClasses = regularClasses.filter((cls) =>
    classNames.some((name) => cls.includes(`public class ${name}`))
  );

  if (sectionClasses.length > 0) {
    output += `// ============================================================================
    // ${sectionName}
    // ============================================================================

${sectionClasses.join('\n\n')}

`;
  }
}

// ============================================================================
// GENERATE DISCRIMINATED UNIONS (BASE CLASSES + VARIANTS + CONVERTERS)
// ============================================================================

/**
 * Generate base class for a discriminated union
 */
function generateUnionBaseClass(unionName, config) {
  const { commonProps, discriminators, baseClassName } = config;

  let baseProps = '';

  // First, add all discriminators as abstract properties
  for (const disc of discriminators) {
    baseProps += `
[JsonProperty("${disc}")]
        public abstract string ${pascalCase(disc)} { get; }
`;
  }

  // Extract base class from variants that use allOf with a base class
  // (e.g., InputNumberLayoutItem references LayoutItemBase)
  let baseClassProps = {};
  for (const variantName of config.variants) {
    const variant = definitions[variantName];
    if (variant && variant.allOf) {
      for (const item of variant.allOf) {
        if (item.$ref && item.$ref.includes('ItemBase')) {
          const refName = item.$ref.replace('#/definitions/', '');
          const refDef = definitions[refName];
          if (refDef && refDef.properties) {
            Object.assign(baseClassProps, refDef.properties);
          }
        }
      }
    }
  }

  // Add base class properties (excluding discriminators), using the base schema's required list
  const baseClassRequired = [];
  for (const variantName of config.variants) {
    const variant = definitions[variantName];
    if (variant?.allOf) {
      for (const item of variant.allOf) {
        if (item.$ref && item.$ref.includes('ItemBase')) {
          const refDef = definitions[item.$ref.replace('#/definitions/', '')];
          if (refDef?.required) baseClassRequired.push(...refDef.required);
        }
      }
      break;
    }
  }
  for (const [propName, prop] of Object.entries(baseClassProps)) {
    if (!discriminators.includes(propName)) {
      const required = baseClassRequired.includes(propName);
      baseProps += `${generateProperty(propName, prop, required)}
`;
    }
  }

  // Then add common properties (excluding discriminators and base properties)
  const addedProps = new Set(Object.keys(baseClassProps));
  for (const propName of commonProps) {
    if (!discriminators.includes(propName) && !addedProps.has(propName)) {
      // Find the property definition from any variant
      for (const variantName of config.variants) {
        const variant = definitions[variantName];
        if (variant) {
          const { properties, required: requiredFields } = resolveDefinition(variant);
          const prop = properties[propName];
          if (prop) {
            const required = requiredFields.includes(propName);
            baseProps += `${generateProperty(propName, prop, required)}
`;
            break;
          }
        }
      }
    }
  }

  return `/// <summary>
    /// Base class for ${unionName} discriminated union
    /// </summary>
    [JsonConverter(typeof(${baseClassName}Converter))]
    public abstract class ${baseClassName}
    {${baseProps}
    }`;
}

/**
 * Generate variant class for a discriminated union
 */
function generateUnionVariantClass(variantName, unionConfig) {
  const def = definitions[variantName];
  const { properties, required } = resolveDefinition(def);
  const { commonProps, discriminators, baseClassName } = unionConfig;

  // Get discriminator values — use null for discriminators this variant doesn't define
  const discriminatorOverrides = discriminators
    .map((disc) => {
      const value = properties[disc]?.const;
      return value !== undefined
        ? `public override string ${pascalCase(disc)} => "${value}";`
        : `public override string ${pascalCase(disc)} => null;`;
    })
    .join('\n');

  // Build set of properties to exclude: commonProps, discriminators, and base class props
  const excludedProps = new Set(commonProps);
  discriminators.forEach((d) => excludedProps.add(d));

  // Also exclude properties from the base class definition (e.g., LayoutItemBase)
  for (const variantName of unionConfig.variants) {
    const variant = definitions[variantName];
    if (variant?.allOf) {
      for (const item of variant.allOf) {
        if (item.$ref && item.$ref.includes('ItemBase')) {
          const refName = item.$ref.replace('#/definitions/', '');
          const refDef = definitions[refName];
          if (refDef?.properties) {
            Object.keys(refDef.properties).forEach((p) => excludedProps.add(p));
          }
        }
      }
    }
  }

  // Get variant-specific properties (not in base class or discriminators)
  const variantProps = Object.entries(properties)
    .filter(([propName]) => !excludedProps.has(propName))
    .map(([propName, prop]) => generateProperty(propName, prop, required.includes(propName)))
    .join('\n');

  const propsSection = variantProps ? `\n${variantProps}` : '';

  return `public class ${variantName} : ${baseClassName}
    {
${discriminatorOverrides}${propsSection}
    }`;
}

/**
 * Generate JSON converter for a discriminated union
 */
function generateUnionConverter(unionName, config) {
  const { variants, discriminators, baseClassName } = config;

  // Build the condition checking code
  const conditions = variants
    .map((variantName, index) => {
      const def = definitions[variantName];
      const { properties } = resolveDefinition(def);
      // Only check discriminators that this variant actually defines as const
      const checks = discriminators
        .filter((disc) => properties[disc]?.const !== undefined)
        .map((disc) => `${disc} == "${properties[disc].const}"`)
        .join(' && ');

      const prefix = index === 0 ? 'if' : 'else if';
      return `            ${prefix} (${checks || 'true'})
                item = new ${variantName}();`;
    })
    .join('\n');

  // Build the variable declarations
  const varDeclarations = discriminators
    .map((disc) => `var ${disc} = jsonObject["${disc}"]?.Value<string>();`)
    .join('\n');

  return `
    /// <summary>
    /// JSON converter for ${baseClassName} discriminated union
    /// </summary>
    public class ${baseClassName}Converter : JsonConverter<${baseClassName}>
    {
        public override ${baseClassName} ReadJson(JsonReader reader, Type objectType, ${baseClassName} existingValue, bool hasExistingValue, JsonSerializer serializer)
        {
            var jsonObject = JObject.Load(reader);
${varDeclarations}

            // Check if all discriminators are null or empty
            var allEmpty = ${discriminators.map((d) => `string.IsNullOrEmpty(${d})`).join(' && ')};
            if (allEmpty)
            {
                throw new JsonSerializationException($"${unionName} discriminator fields are missing or empty. JSON: {jsonObject.ToString()}");
            }

            ${baseClassName} item;
${conditions}
            else
                throw new JsonSerializationException($"Unknown ${unionName} variant: ${discriminators.map((d) => `{${d}}`).join('/')}. JSON: {jsonObject.ToString()}");

            serializer.Populate(jsonObject.CreateReader(), item);
            return item;
        }

        public override void WriteJson(JsonWriter writer, ${baseClassName} value, JsonSerializer serializer)
        {
            // Serialize by writing properties directly to avoid converter recursion
            writer.WriteStartObject();

            ${config.variants
              .filter((v) => {
                const def = definitions[v];
                const { properties } = resolveDefinition(def);
                return discriminators.some((d) => properties[d]?.const === undefined);
              })
              .map((v) => {
                const def = definitions[v];
                const { properties } = resolveDefinition(def);
                const writableProps = Object.keys(properties).filter((p) => properties[p]?.const !== undefined || !discriminators.includes(p));
                const writes = writableProps.map((p) => `writer.WritePropertyName("${p}"); serializer.Serialize(writer, ((${v})value).${pascalCase(p)});`).join('\n                ');
                return `if (value is ${v})\n            {\n                ${writes}\n                writer.WriteEndObject();\n                return;\n            }`;
              })
              .join('\n            ')}

            // Use reflection to get all properties from the concrete type
            var properties = value.GetType().GetProperties();
            foreach (var property in properties)
            {
                var propValue = property.GetValue(value);

                // Skip null values (discriminator properties return null when not applicable to variant)
                if (propValue == null)
                    continue;

                // Get JsonProperty attribute - check property and base declaration
                var jsonAttr = property.GetCustomAttributes(typeof(JsonPropertyAttribute), true)
                    .FirstOrDefault() as JsonPropertyAttribute;

                // If not found and property is an override, check base class
                if (jsonAttr == null && property.GetGetMethod()?.GetBaseDefinition() != property.GetGetMethod())
                {
                    var baseProperty = property.DeclaringType?.BaseType?.GetProperty(property.Name);
                    if (baseProperty != null)
                    {
                        jsonAttr = baseProperty.GetCustomAttributes(typeof(JsonPropertyAttribute), true)
                            .FirstOrDefault() as JsonPropertyAttribute;
                    }
                }

                var jsonName = jsonAttr?.PropertyName ?? property.Name;

                writer.WritePropertyName(jsonName);
                serializer.Serialize(writer, propValue);
            }

            writer.WriteEndObject();
        }
    }`;
}

// Generate all discriminated unions
for (const [unionName, config] of Object.entries(discriminatedUnions)) {
  output += `// ============================================================================
    // ${unionName.toUpperCase()} (Discriminated Union)
    // ============================================================================

${generateUnionBaseClass(unionName, config)}

${config.variants.map((v) => generateUnionVariantClass(v, config)).join('\n\n')}

`;
}

// Generate JSON converters for all discriminated unions
output += `// ============================================================================
    // JSON CONVERTERS FOR DISCRIMINATED UNIONS
    // ============================================================================

`;

for (const [unionName, config] of Object.entries(discriminatedUnions)) {
  output += `${generateUnionConverter(unionName, config)}

`;
}

output += `}
`;

// Ensure output directory exists
const outputDir = path.dirname(outputPath);
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

fs.writeFileSync(outputPath, output);
console.log(`Generated C# types at: ${outputPath}`);

// Update SchemaVersion.cs from the schemaVersion default in the JSON schema
const schemaVersionDefault = schema.definitions?.UISchema?.properties?.schemaVersion?.default;
if (schemaVersionDefault) {
  const [major, minor, patch] = schemaVersionDefault.split('.').map(Number);
  const schemaVersionPath = path.join(repoRoot, 'Plugin/Selva.Schema/Constants/SchemaVersion.cs');
  const schemaVersionContent = `using System;

namespace Selva.Schema.Constants;

/// <summary>
///   Central definition of schema version constants.
///   This is the single source of truth for schema versioning.
/// </summary>
public static class SchemaVersion
{
	/// <summary>
	///   Current version of the schema format (MAJOR.MINOR.PATCH).
	///   Update this when making breaking or non-breaking changes to the schema.
	/// </summary>
	public static readonly Version CURRENT = new(${major}, ${minor}, ${patch});

	/// <summary>
	///   Current version as a string (e.g., "${schemaVersionDefault}").
	///   Used for serialization and comparison.
	/// </summary>
	public static readonly string CURRENT_STRING = CURRENT.ToString();
}
`;
  fs.writeFileSync(schemaVersionPath, schemaVersionContent);
  console.log(`Updated SchemaVersion.cs to ${schemaVersionDefault} at: ${schemaVersionPath}`);
}
