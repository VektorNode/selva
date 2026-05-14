using System.Collections.Generic;
using System.Linq;

namespace Selva.Schema.Services.Validation;

/// <summary>
///     Result of schema validation
/// </summary>
public class ValidationResult
{
    public bool IsValid { get; set; }
    public List<ValidationIssue> Issues { get; set; } = new List<ValidationIssue>();

    public bool HasErrors => Issues.Any(i => i.Severity == ValidationSeverity.Error);
    public bool HasWarnings => Issues.Any(i => i.Severity == ValidationSeverity.Warning);

    public IEnumerable<ValidationIssue> Errors => Issues.Where(i => i.Severity == ValidationSeverity.Error);
    public IEnumerable<ValidationIssue> Warnings => Issues.Where(i => i.Severity == ValidationSeverity.Warning);
    public IEnumerable<ValidationIssue> Infos => Issues.Where(i => i.Severity == ValidationSeverity.Info);

    public static ValidationResult Success()
    {
        return new ValidationResult { IsValid = true };
    }

    public static ValidationResult Failure(string message)
    {
        return new ValidationResult
        {
            IsValid = false,
            Issues = new List<ValidationIssue>
            {
                ValidationIssue.Error(null, message)
            }
        };
    }
}
