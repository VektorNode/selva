using System.Collections.Generic;
using Selva.Schema.Models;

namespace Selva.Schema.Services.Validation;

/// <summary>
///     One self-contained check that runs against a UISchema.
/// </summary>
public interface IValidationRule
{
    IEnumerable<ValidationIssue> Validate(UISchema schema);
}
