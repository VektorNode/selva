using System;
using System.Collections.Generic;
using Selva.Schema.Models;

namespace Selva.Schema.Services.Validation.Rules;

public class ParameterValidationRule : IValidationRule
{
    public IEnumerable<ValidationIssue> Validate(UISchema schema)
    {
        if (schema.Inputs == null || schema.Outputs == null)
        {
            yield break; // BasicStructureRule already flagged this
        }

        var inputIds = new HashSet<Guid>();

        foreach (var input in schema.Inputs)
        {
            if (input.Id == Guid.Empty)
            {
                yield return ValidationIssue.Error(
                    null,
                    "Input parameter has empty ID",
                    "All InputParamSchema entries must have a non-empty GUID");
                continue;
            }

            if (!inputIds.Add(input.Id))
            {
                yield return ValidationIssue.Error(
                    input.Id.ToString(),
                    $"Duplicate input parameter ID: {input.Id}",
                    "Each input parameter must have a unique ID");
            }

            if (string.IsNullOrEmpty(input.ParamType))
            {
                yield return ValidationIssue.Warning(
                    input.Id.ToString(),
                    $"Input {input.Nickname ?? input.Id.ToString()} has no param type specified",
                    "ParamType should be specified for proper parameter handling");
            }
        }

        var outputIds = new HashSet<Guid>();

        foreach (var output in schema.Outputs)
        {
            if (output.Id == Guid.Empty)
            {
                yield return ValidationIssue.Error(
                    null,
                    "Output parameter has empty ID",
                    "All output entries must have a non-empty GUID");
                continue;
            }

            if (!outputIds.Add(output.Id))
            {
                yield return ValidationIssue.Error(
                    output.Id.ToString(),
                    $"Duplicate output parameter ID: {output.Id}",
                    "Each output parameter must have a unique ID");
            }
        }
    }
}
