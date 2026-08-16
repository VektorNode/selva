# Validation System

Rule-based validation for UI schemas: each concern (structure, parameters, layout, ...) is its own rule class instead of one monolithic validator.

## Types

- `IValidationRule` — one self-contained check: `IEnumerable<ValidationIssue> Validate(UISchema)`
- `SchemaValidator` — runs the rules and aggregates their issues
- `ValidationResult` — the outcome plus every issue found
- `ValidationIssue` — one problem, built via `ValidationIssue.Error` / `.Warning` / `.Info`

## Built-in rules (`Rules/`)

| Rule                      | Checks                                                       |
| ------------------------- | ------------------------------------------------------------ |
| `BasicStructureRule`      | Required top-level fields: Id, Name, Inputs, Outputs, Layout |
| `ParameterValidationRule` | Input/output parameter definitions and uniqueness            |
| `LayoutValidationRule`    | Layout structure and its parameter references                |
| `WidgetConfigRule`        | Widget-specific config — number ranges, dropdown options     |
| `VersioningRule`          | Schema versioning information                                |
| `ConstraintsRule`         | Business rules and data constraints                          |

## Usage

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

### Custom rules

Implement `IValidationRule`:

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

Then compose it — add to the defaults, drop a default, or supply the whole set:

```csharp
var validator = new SchemaValidator();
validator.AddRule(new CustomRule());
validator.RemoveRule<VersioningRule>();

// Or start from an explicit set instead of the defaults:
var explicitSet = new SchemaValidator(new IValidationRule[]
{
    new BasicStructureRule(),
    new ParameterValidationRule(),
    new CustomRule()
});
```

Each rule is added, removed, and tested independently — new validation logic never touches existing rules.
