#nullable enable
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;

namespace Selva.GH.Features.Inventory.Services;

/// <summary>
///     Flags text that looks like it holds a credential. A hint for the author, not a scanner: a
///     clean result does not mean the text holds no secret. Returns rule names only, so the matched
///     text never leaves the .gh.
/// </summary>
public static class SecretScanner
{
    static readonly (string Rule, Regex Pattern)[] Rules =
    {
        ("private-key", Rx(@"-----BEGIN [A-Z ]*PRIVATE KEY-----")),
        ("aws-access-key", Rx(@"\b(AKIA|ASIA)[0-9A-Z]{16}\b")),
        ("github-token", Rx(@"\b(gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{40,})")),
        ("slack-token", Rx(@"\bxox[abprs]-[A-Za-z0-9-]{10,}")),
        ("google-api-key", Rx(@"\bAIza[0-9A-Za-z_-]{35}\b")),
        ("stripe-key", Rx(@"\b[sr]k_(live|test)_[0-9A-Za-z]{20,}")),
        ("jwt", Rx(@"\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}")),
        ("bearer-token", Rx(@"\bBearer\s+[A-Za-z0-9._~+/-]{20,}=*")),
        ("connection-string", Rx(@"\b[a-z][a-z0-9+]*://[^\s:/@""']+:[^\s@/""']+@")),
        ("password-assignment", Rx(
            @"\b(password|passwd|pwd|secret|api[_-]?key|apikey|access[_-]?token|auth[_-]?token|client[_-]?secret)\b[""']?\s*[:=]\s*[@$]?[""'][^""'\s]{6,}[""']",
            RegexOptions.IgnoreCase))
    };

    static Regex Rx(string pattern, RegexOptions extra = RegexOptions.None) =>
        new(pattern, RegexOptions.Compiled | RegexOptions.CultureInvariant | extra, TimeSpan.FromMilliseconds(250));

    public static List<string> Scan(string? text)
    {
        if (string.IsNullOrEmpty(text)) return new List<string>();
        return Rules.Where(r => Matches(r.Pattern, text!)).Select(r => r.Rule).ToList();
    }

    static bool Matches(Regex pattern, string text)
    {
        try { return pattern.IsMatch(text); }
        catch (RegexMatchTimeoutException) { return false; }
    }
}
