using System.Collections.Generic;
using System.Linq;
using Selva.Schema.Models;
using Selva.Schema.Services.Validation.Rules;

namespace Selva.Schema.Services.Validation;

/// <summary>
///     Runs a schema through a composable set of validation rules.
///     Add new validation logic by implementing <see cref="IValidationRule"/>.
/// </summary>
public class SchemaValidator
{
    private readonly List<IValidationRule> _rules;

    public SchemaValidator() : this(GetDefaultRules())
    {
    }

    public SchemaValidator(IEnumerable<IValidationRule> rules)
    {
        _rules = rules.ToList();
    }

    private static IEnumerable<IValidationRule> GetDefaultRules()
    {
        return new IValidationRule[]
        {
            new BasicStructureRule(),
            new ParameterValidationRule(),
            new LayoutValidationRule(),
            new WidgetConfigRule(),
            new VersioningRule(),
            new ConstraintsRule()
        };
    }

    public ValidationResult Validate(UISchema schema)
    {
        if (schema == null)
        {
            return ValidationResult.Failure("Schema is null");
        }

        var issues = new List<ValidationIssue>();

        foreach (var rule in _rules)
        {
            issues.AddRange(rule.Validate(schema));
        }

        return new ValidationResult
        {
            IsValid = !issues.Any(i => i.Severity == ValidationSeverity.Error),
            Issues = issues
        };
    }

    public void AddRule(IValidationRule rule)
    {
        _rules.Add(rule);
    }

    public void RemoveRule<T>() where T : IValidationRule
    {
        _rules.RemoveAll(r => r is T);
    }
}
