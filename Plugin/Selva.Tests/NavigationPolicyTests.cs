using Selva.RhinoPanel;

namespace Selva.Tests;

public class NavigationPolicyTests
{
    private static readonly Uri Session = new("http://localhost:51234/?session=abc&wsPort=8765&host=rhino");

    [Theory]
    [InlineData("http://localhost:51234/settings")]
    [InlineData("http://LOCALHOST:51234/?session=other")]
    [InlineData("about:blank")]
    public void TheSessionOrigin_LoadsInThePanel(string url)
    {
        Assert.Equal(NavigationDecision.Allow, NavigationPolicy.Decide(Session, new Uri(url)));
    }

    [Theory]
    [InlineData("https://docs.selva.dev/")]
    [InlineData("http://localhost:3000/")]
    [InlineData("http://127.0.0.1:51234/")]
    public void HttpsAndOtherLoopbackOrigins_OpenInTheBrowser(string url)
    {
        Assert.Equal(NavigationDecision.OpenInBrowser, NavigationPolicy.Decide(Session, new Uri(url)));
    }

    [Theory]
    [InlineData("https://docs.selva.dev/")]
    [InlineData("http://localhost:3000/")]
    public void NewWindowLinks_ElsewhereOpenInTheBrowser(string url)
    {
        Assert.Equal(NavigationDecision.OpenInBrowser, NavigationPolicy.DecideNewWindow(Session, new Uri(url)));
    }

    // The browser must never get a URL that can carry the session's secret.
    [Theory]
    [InlineData("http://localhost:51234/?session=abc&wsPort=8765#s=SECRET")]
    [InlineData("http://localhost:51234/settings")]
    [InlineData("about:blank")]
    [InlineData("selva-panel://open")]
    [InlineData("blob:http://localhost:51234/6a1e2c1f-0000-4000-8000-000000000000")]
    public void NewWindowLinks_OnTheSessionOriginOrNotWebAreBlocked(string url)
    {
        Assert.Equal(NavigationDecision.Block, NavigationPolicy.DecideNewWindow(Session, new Uri(url)));
    }

    [Fact]
    public void SelvaPanelLinks_AreCommandsForTheHost()
    {
        var link = new Uri("selva-panel://toggle-window");
        Assert.Equal(NavigationDecision.HostCommand, NavigationPolicy.Decide(Session, link));
        Assert.Equal(NavigationPolicy.ToggleWindowCommand, link.Host);
    }

    [Theory]
    [InlineData("blob:http://localhost:51234/6a1e2c1f-0000-4000-8000-000000000000")]
    [InlineData("data:text/plain;base64,aGVsbG8=")]
    [InlineData("http://example.com/")]
    [InlineData("file:///etc/passwd")]
    [InlineData("mailto:someone@example.com")]
    public void EverythingElse_IsBlocked(string url)
    {
        Assert.Equal(NavigationDecision.Block, NavigationPolicy.Decide(Session, new Uri(url)));
    }
}
