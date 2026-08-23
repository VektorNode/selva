namespace Selva.Schema.Services.Validation;

public enum ValidationSeverity
{
    Info,
    Warning,
    Error
}

public class ValidationIssue
{
    public string ParamId { get; set; }
    public ValidationSeverity Severity { get; set; }
    public string Message { get; set; }
    public string Details { get; set; }

    public static ValidationIssue Error(string paramId, string message, string details = null)
    {
        return new ValidationIssue
        {
            ParamId = paramId,
            Severity = ValidationSeverity.Error,
            Message = message,
            Details = details
        };
    }

    public static ValidationIssue Warning(string paramId, string message, string details = null)
    {
        return new ValidationIssue
        {
            ParamId = paramId,
            Severity = ValidationSeverity.Warning,
            Message = message,
            Details = details
        };
    }

    public static ValidationIssue Info(string paramId, string message, string details = null)
    {
        return new ValidationIssue
        {
            ParamId = paramId,
            Severity = ValidationSeverity.Info,
            Message = message,
            Details = details
        };
    }

    public override string ToString()
    {
        var prefix = Severity switch
        {
            ValidationSeverity.Error => "ERROR",
            ValidationSeverity.Warning => "WARNING",
            ValidationSeverity.Info => "INFO",
            _ => "UNKNOWN"
        };

        var location = string.IsNullOrEmpty(ParamId) ? "" : $" ({ParamId})";
        var details = string.IsNullOrEmpty(Details) ? "" : $" - {Details}";

        return $"[{prefix}]{location}: {Message}{details}";
    }
}
