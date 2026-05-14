using System.Collections.Generic;
using System.Linq;
using Selva.Schema.Models;
using Selva.Schema.Services.Validation.Rules;

namespace Selva.Schema.Services.Validation;

/// <summary>
///     Centralized schema validation using composable rules.
///     Add new validation logic by creating a new IValidationRule implementation.
/// </summary>
public class SchemaValidator
{
    private readonly List<IValidationRule> _rules;

    /// <summary>
    ///     Create validator with default rules
    /// </summary>
    public SchemaValidator() : this(GetDefaultRules())
    {
    }

    /// <summary>
    ///     Create validator with custom rules
    /// </summary>
    public SchemaValidator(IEnumerable<IValidationRule> rules)
    {
        _rules = rules.ToList();
    }

    /// <summary>
    ///     Get the default validation rules
    /// </summary>
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

    /// <summary>
    ///     Validate a schema and return detailed results
    /// </summary>
    public ValidationResult Validate(UISchema schema)
    {
        if (schema == null)
        {
            return ValidationResult.Failure("Schema is null");
        }

        var issues = new List<ValidationIssue>();

        // Run each validation rule
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

    /// <summary>
    ///     Add a custom validation rule
    /// </summary>
    public void AddRule(IValidationRule rule)
    {
        _rules.Add(rule);
    }

    /// <summary>
    ///     Remove all rules of a specific type
    /// </summary>
    public void RemoveRule<T>() where T : IValidationRule
    {
        _rules.RemoveAll(r => r is T);
    }
}
