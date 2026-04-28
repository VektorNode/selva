using System.Collections.Generic;
using Selva.Schema.Models;

namespace Selva.Schema.Services.Validation;

/// <summary>
///     Interface for modular validation rules.
///     Each rule performs a specific validation check on a UISchema.
/// </summary>
public interface IValidationRule
{
    /// <summary>
    ///     Validate the schema and return any issues found.
    /// </summary>
    IEnumerable<ValidationIssue> Validate(UISchema schema);
}
