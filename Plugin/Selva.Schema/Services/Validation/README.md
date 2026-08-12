# Validation System

Rule-based validation for UI schemas: each concern (structure, parameters, layout, ...) is its own rule class instead of one monolithic validator.

## Architecture

### Core Components

1. **IValidationRule** - Interface that all validation rules implement
2. **SchemaValidator** - Orchestrates validation by running all rules
3. **ValidationResult** - Contains validation outcome and any issues found
4. **ValidationIssue** - Represents a single validation problem (Error, Warning, or Info)

### Built-in Rules

Located in `Services/Validation/Rules/`:

- **BasicStructureRule** - Validates required top-level fields (Id, Name, Inputs, Outputs, Layout)
- **ParameterValidationRule** - Validates input/output parameter definitions and uniqueness
- **LayoutValidationRule** - Validates layout structure and parameter references
- **WidgetConfigRule** - Validates widget-specific configurations (number ranges, dropdown options)
- **VersioningRule** - Validates schema versioning information
- **ConstraintsRule** - Validates business rules and data constraints

## Usage

### Basic Validation

```csharp
using Selva.Schema.Services.Validation;

var validator = new SchemaValidator();
var result = validator.Validate(schema);

if (!result.IsValid)
{
    foreach (var error in result.Errors)
    {
        Console.WriteLine(error);
    }
}
```

### Adding Custom Rules

Create a new rule by implementing `IValidationRule`:

```csharp
public class CustomRule : IValidationRule
{
    public IEnumerable<ValidationIssue> Validate(UISchema schema)
    {
        // Your validation logic here
        if (someCondition)
        {
            yield return ValidationIssue.Error(
                paramId: "param-id",
                message: "Something is wrong",
                details: "More details about the issue");
        }
    }
}
```

Then add it to the validator:

```csharp
var validator = new SchemaValidator();
validator.AddRule(new CustomRule());
var result = validator.Validate(schema);
```

### Creating a Validator with Custom Rules

```csharp
var customRules = new IValidationRule[]
{
    new BasicStructureRule(),
    new ParameterValidationRule(),
    new CustomRule()
};

var validator = new SchemaValidator(customRules);
```

### Removing Rules

```csharp
var validator = new SchemaValidator();
validator.RemoveRule<VersioningRule>(); // Remove versioning validation
```

Each rule can be added, removed, or tested independently — new validation logic doesn't touch existing rules.
