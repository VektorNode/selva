using Selva.GH.Features.SelvaUpload.Services;

namespace Selva.Tests;

public class OAuthLoopbackTests
{
    private const string State = "state-123";
    private const string Issuer = "https://selva.example.com";

    // RFC 7636 appendix B.
    [Fact]
    public void Challenge_MatchesTheRfcVector()
    {
        Assert.Equal("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
            Pkce.Challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"));
    }

    [Fact]
    public void VerifierAndState_Are32RandomBytes()
    {
        Assert.Matches("^[A-Za-z0-9_-]{43}$", Pkce.NewVerifier());
        Assert.Matches("^[A-Za-z0-9_-]{43}$", Pkce.NewState());
        Assert.NotEqual(Pkce.NewVerifier(), Pkce.NewVerifier());
    }

    [Fact]
    public void AuthorizeUrl_AsksForUploadWithPkceOnTheLoopbackRedirect()
    {
        var url = OAuthCallback.AuthorizeUrl("https://selva.example.com/oauth/authorize",
            "http://127.0.0.1:50123/callback", "CHALLENGE", State, Issuer);

        Assert.Equal(
            "https://selva.example.com/oauth/authorize?response_type=code&client_id=selva-grasshopper" +
            "&redirect_uri=http%3A%2F%2F127.0.0.1%3A50123%2Fcallback&code_challenge=CHALLENGE" +
            "&code_challenge_method=S256&state=state-123&scope=upload&resource=https%3A%2F%2Fselva.example.com",
            url);
    }

    [Fact]
    public void Callback_WithCodeStateAndIssuer_YieldsTheCode()
    {
        var result = OAuthCallback.Parse(
            "/callback?code=abc%2Bdef&state=state-123&iss=https%3A%2F%2Fselva.example.com", State, Issuer);

        Assert.Equal(OAuthCallbackKind.Code, result!.Kind);
        Assert.Equal("abc+def", result.Code);
    }

    [Fact]
    public void Callback_DeniedByTheUser_ReadsAsCancelled()
    {
        var result = OAuthCallback.Parse(
            "/callback?error=access_denied&state=state-123&iss=https%3A%2F%2Fselva.example.com", State, Issuer);
        Assert.Equal(OAuthCallbackKind.Cancelled, result!.Kind);
    }

    [Theory]
    [InlineData("/callback?code=abc&state=other&iss=https%3A%2F%2Fselva.example.com")]
    [InlineData("/callback?code=abc&iss=https%3A%2F%2Fselva.example.com")]
    [InlineData("/callback?code=abc&state=state-123&iss=https%3A%2F%2Fevil.example")]
    [InlineData("/callback?code=abc&state=state-123")]
    [InlineData("/callback?state=state-123&iss=https%3A%2F%2Fselva.example.com")]
    [InlineData("/callback?code=&state=state-123&iss=https%3A%2F%2Fselva.example.com")]
    [InlineData("/callback?code=a&code=b&state=state-123&iss=https%3A%2F%2Fselva.example.com")]
    [InlineData("/callback?error=server_error&state=state-123&iss=https%3A%2F%2Fselva.example.com")]
    [InlineData("/callback?error=access_denied&state=other&iss=https%3A%2F%2Fselva.example.com")]
    public void Callback_ThatDoesNotAnswerThisRequest_Fails(string target)
    {
        var result = OAuthCallback.Parse(target, State, Issuer);
        Assert.Equal(OAuthCallbackKind.Failed, result!.Kind);
        Assert.Null(result.Code);
    }

    [Fact]
    public void Callback_WithAnotherState_IsNotFromThisSignIn()
    {
        Assert.False(OAuthCallback.Parse("/callback?code=abc&state=other", State, Issuer)!.FromThisSignIn);
        Assert.True(OAuthCallback.Parse("/callback?code=abc&state=state-123", State, Issuer)!.FromThisSignIn);
    }

    [Theory]
    [InlineData("/favicon.ico")]
    [InlineData("/")]
    [InlineData("/callbackx?code=abc")]
    public void OtherPaths_AreNotTheCallback(string target)
    {
        Assert.Null(OAuthCallback.Parse(target, State, Issuer));
    }

    [Fact]
    public void Failure_NeverEchoesWhatTheServerSent()
    {
        var result = OAuthCallback.Parse(
            "/callback?error=%3Cscript%3E&error_description=evil&state=state-123&iss=https%3A%2F%2Fselva.example.com",
            State, Issuer);
        Assert.DoesNotContain("<script>", result!.Error);
        Assert.DoesNotContain("evil", result.Error);
    }
}
