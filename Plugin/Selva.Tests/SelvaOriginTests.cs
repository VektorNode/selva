using Selva.GH.Features.SelvaUpload.Services;

namespace Selva.Tests;

public class SelvaOriginTests
{
    [Theory]
    [InlineData("selva.example.com", "https://selva.example.com")]
    [InlineData("  https://selva.example.com/  ", "https://selva.example.com")]
    [InlineData("https://Selva.Example.COM/library/abc?x=1#y", "https://selva.example.com")]
    [InlineData("https://selva.example.com:8443", "https://selva.example.com:8443")]
    [InlineData("https://selva.example.com:443/", "https://selva.example.com")]
    [InlineData("localhost:5199", "https://localhost:5199")]
    [InlineData("http://localhost:5199", "http://localhost:5199")]
    [InlineData("http://127.0.0.1:5199", "http://127.0.0.1:5199")]
    [InlineData("http://[::1]:5199", "http://[::1]:5199")]
    [InlineData("https://bücher.example", "https://xn--bcher-kva.example")]
    public void Normalize_ReducesToAnOrigin(string input, string expected)
    {
        Assert.True(SelvaOrigin.TryNormalize(input, out var origin, out var error), error);
        Assert.Equal(expected, origin);
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("http://selva.example.com")]
    [InlineData("http://localhost.evil.example")]
    [InlineData("http://127.0.0.2")]
    [InlineData("ftp://selva.example.com")]
    [InlineData("file:///etc/passwd")]
    [InlineData("javascript:alert(1)")]
    [InlineData("https://user:pass@selva.example.com")]
    [InlineData("https://user@selva.example.com")]
    [InlineData("https://")]
    [InlineData("not a web address")]
    public void Normalize_RefusesWithAReason(string input)
    {
        Assert.False(SelvaOrigin.TryNormalize(input, out var origin, out var error));
        Assert.Null(origin);
        Assert.False(string.IsNullOrWhiteSpace(error));
    }

    [Theory]
    [InlineData("https://selva.example.com", "selva.example.com")]
    [InlineData("https://xn--bcher-kva.example:8443", "xn--bcher-kva.example:8443")]
    [InlineData("http://localhost:5199", "localhost:5199")]
    public void DisplayHost_IsTheOriginWithoutItsScheme(string origin, string expected)
    {
        Assert.Equal(expected, SelvaOrigin.DisplayHost(origin));
    }

    [Theory]
    [InlineData("https://selva.example.com", "https://selva.example.com/oauth/token", true)]
    [InlineData("https://selva.example.com", "https://selva.example.com:443/oauth/token", true)]
    [InlineData("https://selva.example.com", "https://SELVA.example.com/x", true)]
    [InlineData("https://selva.example.com", "http://selva.example.com/oauth/token", false)]
    [InlineData("https://selva.example.com", "https://evil.example/oauth/token", false)]
    [InlineData("https://selva.example.com", "https://selva.example.com.evil.example/x", false)]
    [InlineData("https://selva.example.com", "https://selva.example.com:8443/x", false)]
    [InlineData("https://selva.example.com", "selvaprotocol://selva.example.com/x", false)]
    [InlineData("https://selva.example.com", "/oauth/token", false)]
    [InlineData("http://localhost:5199", "http://localhost:5199/oauth/token", true)]
    public void IsOnOrigin_ComparesSchemeHostAndPort(string origin, string url, bool expected)
    {
        Assert.Equal(expected, SelvaOrigin.IsOnOrigin(url, origin));
    }
}
