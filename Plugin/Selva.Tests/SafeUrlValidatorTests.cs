using System.Net;
using Selva.FileIO;

namespace Selva.Tests;

public class SafeUrlValidatorTests
{
    // ---- IsPublic: the core allow/deny logic ----

    [Theory]
    [InlineData("8.8.8.8")]            // public DNS
    [InlineData("1.1.1.1")]            // public DNS
    [InlineData("93.184.216.34")]      // example.com
    public void IsPublic_allows_public_ipv4(string ip)
    {
        Assert.True(SafeUrlValidator.IsPublic(IPAddress.Parse(ip)));
    }

    [Theory]
    [InlineData("127.0.0.1")]          // loopback
    [InlineData("169.254.169.254")]    // cloud metadata endpoint
    [InlineData("10.0.0.5")]           // private
    [InlineData("172.16.3.4")]         // private
    [InlineData("172.31.255.255")]     // private (upper bound)
    [InlineData("192.168.1.1")]        // private
    [InlineData("100.64.0.1")]         // carrier-grade NAT
    [InlineData("192.0.0.8")]          // IETF protocol assignments
    [InlineData("192.0.2.10")]         // TEST-NET-1
    [InlineData("198.18.0.1")]         // benchmarking
    [InlineData("198.19.255.254")]     // benchmarking (upper half)
    [InlineData("0.0.0.0")]            // this-network
    [InlineData("255.255.255.255")]    // broadcast
    [InlineData("224.0.0.1")]          // multicast
    public void IsPublic_rejects_non_public_ipv4(string ip)
    {
        Assert.False(SafeUrlValidator.IsPublic(IPAddress.Parse(ip)));
    }

    [Theory]
    [InlineData("::1")]                // loopback
    [InlineData("fe80::1")]            // link-local
    [InlineData("fc00::1")]            // unique-local
    [InlineData("fd12:3456::1")]       // unique-local
    [InlineData("::ffff:10.0.0.1")]    // ipv4-mapped private
    [InlineData("::ffff:169.254.169.254")] // ipv4-mapped metadata
    [InlineData("::")]                 // unspecified
    public void IsPublic_rejects_non_public_ipv6(string ip)
    {
        Assert.False(SafeUrlValidator.IsPublic(IPAddress.Parse(ip)));
    }

    // Each prefix reaches an IPv4 host through a translator or tunnel, so the embedded address
    // decides.
    [Theory]
    [InlineData("64:ff9b::a9fe:a9fe")]     // NAT64 -> 169.254.169.254
    [InlineData("64:ff9b::7f00:1")]        // NAT64 -> 127.0.0.1
    [InlineData("64:ff9b::a00:5")]         // NAT64 -> 10.0.0.5
    [InlineData("64:ff9b:1::a9fe:a9fe")]   // NAT64 local-use prefix, never public
    [InlineData("::a9fe:a9fe")]            // IPv4-compatible -> 169.254.169.254
    [InlineData("::c0a8:101")]             // IPv4-compatible -> 192.168.1.1
    [InlineData("::ffff:a9fe:a9fe")]       // IPv4-mapped, hex form
    [InlineData("::ffff:0:a9fe:a9fe")]     // IPv4-translated (SIIT) -> 169.254.169.254
    [InlineData("::ffff:0:a00:1")]         // IPv4-translated (SIIT) -> 10.0.0.1
    [InlineData("2002:a9fe:a9fe::1")]      // 6to4 -> 169.254.169.254
    [InlineData("2002:a00:1::")]           // 6to4 -> 10.0.0.1
    [InlineData("2002:7f00:1::")]          // 6to4 -> 127.0.0.1
    [InlineData("2001:0:808:808::5601:5601")] // Teredo, client 169.254.169.254 (stored inverted)
    [InlineData("2001:0:a00:1::f7f7:f7f7")]   // Teredo, server 10.0.0.1
    public void IsPublic_rejects_ipv6_that_embeds_a_non_public_ipv4(string ip)
    {
        Assert.False(SafeUrlValidator.IsPublic(IPAddress.Parse(ip)));
    }

    [Theory]
    [InlineData("2606:4700:4700::1111")]
    [InlineData("64:ff9b::808:808")]       // NAT64 -> 8.8.8.8
    [InlineData("2002:808:808::1")]        // 6to4 -> 8.8.8.8
    [InlineData("2001:0:808:808::f7f7:f7f7")] // Teredo, server and client 8.8.8.8
    [InlineData("::ffff:0:808:808")]       // IPv4-translated (SIIT) -> 8.8.8.8
    public void IsPublic_allows_public_ipv6(string ip)
    {
        Assert.True(SafeUrlValidator.IsPublic(IPAddress.Parse(ip)));
    }

    // ---- TryValidate: scheme + literal-IP host handling (no DNS needed) ----

    [Theory]
    [InlineData("ftp://example.com/x")]
    [InlineData("file:///etc/passwd")]
    [InlineData("not a url")]
    public void TryValidate_rejects_non_http_schemes(string url)
    {
        Assert.False(SafeUrlValidator.TryValidate(url, out _, out var err));
        Assert.NotEmpty(err);
    }

    [Theory]
    [InlineData("http://169.254.169.254/latest/meta-data/")]
    [InlineData("http://127.0.0.1:6379/")]
    [InlineData("https://10.0.0.1/")]
    [InlineData("http://[::1]/")]
    [InlineData("http://[64:ff9b::a9fe:a9fe]/latest/meta-data/")]
    [InlineData("http://[2002:a9fe:a9fe::]/latest/meta-data/")]
    public void TryValidate_rejects_literal_internal_ips(string url)
    {
        Assert.False(SafeUrlValidator.TryValidate(url, out _, out var err));
        Assert.NotEmpty(err);
    }

    [Fact]
    public void TryValidate_allows_literal_public_ip()
    {
        Assert.True(SafeUrlValidator.TryValidate("https://8.8.8.8/", out var addrs, out _));
        Assert.NotEmpty(addrs);
    }
}
