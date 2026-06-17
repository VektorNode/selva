using System.Net;
using Selva.GH.Features.FileIO.Services;

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
    public void IsPublic_rejects_non_public_ipv6(string ip)
    {
        Assert.False(SafeUrlValidator.IsPublic(IPAddress.Parse(ip)));
    }

    [Fact]
    public void IsPublic_allows_public_ipv6()
    {
        Assert.True(SafeUrlValidator.IsPublic(IPAddress.Parse("2606:4700:4700::1111")));
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
