using System.Runtime.InteropServices;
using Selva.GH.Features.SelvaUpload.Services;

namespace Selva.Tests;

public class CredentialStoreTests
{
    [Fact]
    public void Memory_RoundTripsPerOrigin()
    {
        var store = new MemoryCredentialStore();
        store.TrySave("https://a.example", "selva_a");
        store.TrySave("https://b.example", "selva_b");

        Assert.Equal("selva_a", store.Load("https://a.example"));
        store.Delete("https://a.example");
        Assert.Null(store.Load("https://a.example"));
        Assert.Equal("selva_b", store.Load("https://b.example"));
    }

    /// <summary>
    ///     Writes to the real login keychain or Credential Manager, so it runs only on request:
    ///     SELVA_CREDENTIAL_STORE_TEST=1 dotnet test --filter CredentialStoreTests
    /// </summary>
    [Fact]
    public void OsStore_RoundTrips()
    {
        if (Environment.GetEnvironmentVariable("SELVA_CREDENTIAL_STORE_TEST") != "1" ||
            !(RuntimeInformation.IsOSPlatform(OSPlatform.OSX) || RuntimeInformation.IsOSPlatform(OSPlatform.Windows)))
        {
            return;
        }

        var store = CredentialStores.ForThisMachine();
        const string origin = "https://credential-store-test.invalid";
        try
        {
            Assert.Equal("keychain", store.Kind);
            Assert.True(store.TrySave(origin, "selva_first"));
            Assert.True(store.TrySave(origin, "selva_second"));
            Assert.Equal("selva_second", store.Load(origin));
        }
        finally
        {
            store.Delete(origin);
        }

        Assert.Null(store.Load(origin));
        store.Delete(origin);
    }
}
