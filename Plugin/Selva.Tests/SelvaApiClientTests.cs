using System.Net;
using System.Net.Http;
using System.Text;
using Newtonsoft.Json.Linq;
using Selva.GH.Features.SelvaUpload.Services;

namespace Selva.Tests;

public class SelvaApiClientTests
{
    private const string Origin = "https://selva.example.com";
    private const string Token = "selva_testtoken";

    [Fact]
    public async Task Requests_ToTheOrigin_CarryTheTokenAndUserAgent()
    {
        var handler = new FakeHandler(_ => Json(200, @"{ ""ok"": true }"));
        using var client = Client(handler);

        await client.GetJsonAsync("/api/v1/me", CancellationToken.None);

        var request = Assert.Single(handler.Requests);
        Assert.Equal("https://selva.example.com/api/v1/me", request.Uri);
        Assert.Equal("Bearer " + Token, request.Authorization);
        Assert.Equal("Selva-Grasshopper/1.2.3 (Rhino 8; test)", request.UserAgent);
    }

    [Fact]
    public async Task Redirect_IsAnErrorAndNeverFollowed()
    {
        var handler = new FakeHandler(_ =>
        {
            var response = new HttpResponseMessage(HttpStatusCode.Found);
            response.Headers.Location = new Uri("https://evil.example/steal");
            return response;
        });
        using var client = Client(handler);

        var ex = await Assert.ThrowsAsync<SelvaApiException>(() =>
            client.GetJsonAsync("/api/v1/me", CancellationToken.None));

        Assert.Contains("evil.example", ex.Message);
        Assert.Single(handler.Requests);
    }

    [Fact]
    public void Paths_ThatLeaveTheOrigin_AreRefusedBeforeSending()
    {
        var handler = new FakeHandler(_ => Json(200, "{}"));
        using var client = Client(handler);

        Assert.ThrowsAsync<SelvaApiException>(() =>
            client.GetJsonAsync("//evil.example/api", CancellationToken.None)).Wait();
        Assert.ThrowsAsync<SelvaApiException>(() =>
            client.GetJsonAsync("https://evil.example/api", CancellationToken.None)).Wait();
        Assert.Empty(handler.Requests);
    }

    [Fact]
    public async Task InvalidToken_IsRecognisedSoTheStoredTokenCanBeDropped()
    {
        var handler = new FakeHandler(_ =>
        {
            var response = Json(401, @"{ ""message"": ""Token expired"", ""code"": ""UNAUTHORIZED"" }");
            response.Headers.WwwAuthenticate.ParseAdd("Bearer error=\"invalid_token\"");
            return response;
        });
        using var client = Client(handler);

        var ex = await Assert.ThrowsAsync<SelvaApiException>(() =>
            client.GetJsonAsync("/api/v1/me", CancellationToken.None));

        Assert.True(ex.InvalidToken);
        Assert.Equal(401, ex.Status);
        Assert.Equal("Token expired", ex.Message);
    }

    [Fact]
    public async Task ErrorBody_MessageIsSurfaced()
    {
        var handler = new FakeHandler(_ =>
            Json(403, @"{ ""message"": ""Missing scope: upload"", ""code"": ""FORBIDDEN"" }"));
        using var client = Client(handler);

        var ex = await Assert.ThrowsAsync<SelvaApiException>(() =>
            client.GetJsonAsync("/api/v1/projects", CancellationToken.None));

        Assert.False(ex.InvalidToken);
        Assert.Equal("Missing scope: upload", ex.Message);
    }

    [Fact]
    public async Task OversizedResponse_IsRefused()
    {
        var big = "{\"x\":\"" + new string('a', (int)SelvaApiClient.MaxJsonBytes) + "\"}";
        var handler = new FakeHandler(_ => Json(200, big));
        using var client = Client(handler);

        await Assert.ThrowsAsync<SelvaApiException>(() =>
            client.GetJsonAsync("/api/v1/me", CancellationToken.None));
    }

    [Fact]
    public async Task UnauthenticatedCalls_SendNoToken()
    {
        var handler = new FakeHandler(_ => Json(200, "{}"));
        using var client = new SelvaApiClient(Origin, null, "ua", handler);

        await client.GetJsonAsync(AuthServerMetadata.WellKnownPath, CancellationToken.None);

        Assert.Null(Assert.Single(handler.Requests).Authorization);
    }

    [Fact]
    public async Task RedeemCode_PostsTheFormAndReadsTheKey()
    {
        var handler = new FakeHandler(_ => Json(200,
            @"{ ""access_token"": ""selva_Abc123XYZabc123XYZabc123XYZabc1GCgGf"", ""token_type"": ""Bearer"",
                ""expires_in"": 2592000, ""scope"": ""upload"" }"));
        using var client = new SelvaApiClient(Origin, null, "ua", handler);

        var token = await client.RedeemCodeAsync("https://selva.example.com/oauth/token", "the-code",
            "http://127.0.0.1:5000/callback", "the-verifier", CancellationToken.None);

        Assert.Equal("selva_Abc123XYZabc123XYZabc123XYZabc1GCgGf", token);
        var request = Assert.Single(handler.Requests);
        Assert.Equal("POST", request.Method);
        Assert.Null(request.Authorization);
        Assert.Equal(
            "grant_type=authorization_code&code=the-code&client_id=selva-grasshopper" +
            "&redirect_uri=http%3A%2F%2F127.0.0.1%3A5000%2Fcallback&code_verifier=the-verifier" +
            "&resource=https%3A%2F%2Fselva.example.com",
            request.Body);
    }

    [Theory]
    [InlineData(@"{ ""access_token"": ""not-a-selva-key"", ""token_type"": ""Bearer"" }")]
    [InlineData(@"{ ""token_type"": ""Bearer"" }")]
    [InlineData(@"{ ""access_token"": ""selva_x"", ""token_type"": ""mac"" }")]
    public async Task RedeemCode_RefusesAnythingButASelvaBearerKey(string body)
    {
        var handler = new FakeHandler(_ => Json(200, body));
        using var client = new SelvaApiClient(Origin, null, "ua", handler);

        await Assert.ThrowsAsync<SelvaApiException>(() => client.RedeemCodeAsync(
            "https://selva.example.com/oauth/token", "c", "http://127.0.0.1:5000/callback", "v",
            CancellationToken.None));
    }

    [Fact]
    public async Task Multipart_RetriesAConnectionFailureWithTheSameIdempotencyKey()
    {
        var calls = 0;
        var handler = new FakeHandler(_ =>
        {
            if (++calls == 1)
            {
                throw new HttpRequestException("connection reset");
            }

            return Json(201, @"{ ""guid"": ""g"" }");
        });
        using var client = Client(handler);

        var result = await client.PostMultipartAsync("/api/v1/definitions",
            () => new MultipartFormDataContent { { new StringContent("x"), "displayName" } },
            CancellationToken.None);

        Assert.Equal("g", (string?)result["guid"]);
        Assert.Equal(2, handler.Requests.Count);
        Assert.NotNull(handler.Requests[0].IdempotencyKey);
        Assert.Equal(handler.Requests[0].IdempotencyKey, handler.Requests[1].IdempotencyKey);
    }

    [Fact]
    public async Task Multipart_DoesNotRetryAnHttpError()
    {
        var handler = new FakeHandler(_ => Json(422, @"{ ""message"": ""No Schema output"" }"));
        using var client = Client(handler);

        await Assert.ThrowsAsync<SelvaApiException>(() => client.PostMultipartAsync("/api/v1/definitions",
            () => new MultipartFormDataContent(), CancellationToken.None));
        Assert.Single(handler.Requests);
    }

    // -------------------------------------------------------------------------

    private static SelvaApiClient Client(HttpMessageHandler handler) =>
        new(Origin, Token, "Selva-Grasshopper/1.2.3 (Rhino 8; test)", handler);

    private static HttpResponseMessage Json(int status, string body) =>
        new((HttpStatusCode)status) { Content = new StringContent(body, Encoding.UTF8, "application/json") };

    internal sealed record SeenRequest(
        string Method, string Uri, string? Authorization, string? UserAgent, string? IdempotencyKey, string? Body);

    internal sealed class FakeHandler : HttpMessageHandler
    {
        private readonly Func<HttpRequestMessage, HttpResponseMessage> _respond;

        public FakeHandler(Func<HttpRequestMessage, HttpResponseMessage> respond)
        {
            _respond = respond;
        }

        public List<SeenRequest> Requests { get; } = new();

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request,
            CancellationToken cancellationToken)
        {
            var body = request.Content is FormUrlEncodedContent form ? await form.ReadAsStringAsync() : null;
            Requests.Add(new SeenRequest(
                request.Method.Method,
                request.RequestUri!.ToString(),
                request.Headers.Authorization?.ToString(),
                request.Headers.TryGetValues("User-Agent", out var ua) ? string.Join(" ", ua) : null,
                request.Headers.TryGetValues("Idempotency-Key", out var key) ? key.Single() : null,
                body));
            return _respond(request);
        }
    }
}
