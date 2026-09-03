using System;
using System.Linq;
using System.Net;
using System.Net.Sockets;

namespace Selva.GH.Features.FileIO.Services;

// ============================================================================
// SSRF protection for user-supplied download URLs
// ============================================================================
//
// User-provided URLs (image / file inputs, both in the local plugin and on the
// Compute server) are an SSRF vector: a crafted URL can make the host fetch
// internal resources, e.g. cloud metadata endpoints (169.254.169.254), loopback
// services, or private-network hosts. This validator resolves the host to its
// real IPs and rejects any that are not publicly routable.
//
// Pure / Rhino-free so it can be unit-tested via source-linking into Selva.Tests.
public static class SafeUrlValidator
{
    /// <summary>
    ///     On success, <paramref name="resolvedAddresses"/> holds the vetted IPs — callers
    ///     on net7+ should pin the connection to one of these to defeat DNS rebinding.
    /// </summary>
    public static bool TryValidate(string url, out IPAddress[] resolvedAddresses, out string errorMessage)
    {
        resolvedAddresses = Array.Empty<IPAddress>();

        if (!Uri.TryCreate(url, UriKind.Absolute, out var uri) ||
            (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps))
        {
            errorMessage = "Invalid URL: only http/https are supported";
            return false;
        }

        IPAddress[] addresses;
        try
        {
            // If the host is already a literal IP, Dns.GetHostAddresses returns it as-is.
            addresses = Dns.GetHostAddresses(uri.DnsSafeHost);
        }
        catch (Exception)
        {
            errorMessage = "Could not resolve the URL host";
            return false;
        }

        if (addresses == null || addresses.Length == 0)
        {
            errorMessage = "Could not resolve the URL host";
            return false;
        }

        // Every resolved address must be public — a public hostname that resolves to a
        // private IP (DNS rebinding) is rejected.
        var blocked = addresses.FirstOrDefault(ip => !IsPublic(ip));
        if (blocked != null)
        {
            errorMessage = $"URL host resolves to a non-public address ({blocked})";
            return false;
        }

        resolvedAddresses = addresses;
        errorMessage = "";
        return true;
    }

    public static bool IsPublic(IPAddress address)
    {
        if (address == null) return false;

        if (IPAddress.IsLoopback(address)) return false; // 127.0.0.0/8, ::1

        if (address.AddressFamily == AddressFamily.InterNetwork)
        {
            return IsPublicV4(address.GetAddressBytes());
        }

        if (address.AddressFamily == AddressFamily.InterNetworkV6)
        {
            // IPv4-mapped IPv6 (::ffff:a.b.c.d): unwrap and check the embedded v4.
            if (address.IsIPv4MappedToIPv6)
            {
                return IsPublicV4(address.MapToIPv4().GetAddressBytes());
            }

            return IsPublicV6(address);
        }

        // Unknown address families are not safe to fetch from.
        return false;
    }

    private static bool IsPublicV4(byte[] b)
    {
        // 0.0.0.0/8        — "this network"
        if (b[0] == 0) return false;
        // 10.0.0.0/8       — private
        if (b[0] == 10) return false;
        // 100.64.0.0/10    — carrier-grade NAT
        if (b[0] == 100 && b[1] >= 64 && b[1] <= 127) return false;
        // 127.0.0.0/8      — loopback (also caught by IsLoopback)
        if (b[0] == 127) return false;
        // 169.254.0.0/16   — link-local (cloud metadata lives here)
        if (b[0] == 169 && b[1] == 254) return false;
        // 172.16.0.0/12    — private
        if (b[0] == 172 && b[1] >= 16 && b[1] <= 31) return false;
        // 192.0.0.0/24, 192.0.2.0/24 (TEST-NET-1) — special-use
        if (b[0] == 192 && b[1] == 0 && (b[2] == 0 || b[2] == 2)) return false;
        // 192.168.0.0/16   — private
        if (b[0] == 192 && b[1] == 168) return false;
        // 198.18.0.0/15    — benchmarking
        if (b[0] == 198 && (b[1] == 18 || b[1] == 19)) return false;
        // 224.0.0.0/4 multicast and 240.0.0.0/4 reserved (incl. 255.255.255.255)
        if (b[0] >= 224) return false;

        return true;
    }

    private static bool IsPublicV6(IPAddress address)
    {
        if (address.IsIPv6LinkLocal) return false;      // fe80::/10
        if (address.IsIPv6SiteLocal) return false;      // fec0::/10 (deprecated)
        if (address.IsIPv6Multicast) return false;      // ff00::/8

        var b = address.GetAddressBytes();

        // ::/128 unspecified, ::1 loopback (loopback already handled above).
        if (b.All(x => x == 0)) return false;

        // fc00::/7 — unique local addresses (private).
        if ((b[0] & 0xFE) == 0xFC) return false;

        return true;
    }
}
