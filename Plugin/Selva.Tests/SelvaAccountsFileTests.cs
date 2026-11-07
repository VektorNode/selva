using Selva.GH.Features.SelvaUpload.Services;

namespace Selva.Tests;

public sealed class SelvaAccountsFileTests : IDisposable
{
    private readonly string _dir = Path.Combine(Path.GetTempPath(), "selva-accounts-" + Guid.NewGuid());

    public void Dispose()
    {
        if (Directory.Exists(_dir))
        {
            Directory.Delete(_dir, true);
        }
    }

    private string FilePath => Path.Combine(_dir, "accounts.json");

    [Fact]
    public void Missing_LoadsEmpty()
    {
        var file = SelvaAccountsFile.Load(FilePath);
        Assert.Null(file.ActiveOrigin);
        Assert.Empty(file.Accounts);
    }

    [Fact]
    public void Corrupt_LoadsEmptyRatherThanFailing()
    {
        Directory.CreateDirectory(_dir);
        File.WriteAllText(FilePath, "{ not json");
        Assert.Empty(SelvaAccountsFile.Load(FilePath).Accounts);
    }

    // That no token reaches this file is SelvaAccountManager's job, tested there: the record has
    // no field that could hold one.
    [Fact]
    public void SavedAccounts_RoundTrip()
    {
        var file = SelvaAccountsFile.Load(FilePath);
        file.ActiveOrigin = "https://selva.example.com";
        file.Upsert(new SelvaAccountRecord
        {
            Origin = "https://selva.example.com",
            Email = "ada@example.com",
            OrgId = "org-1",
            OrgName = "Studio",
            ExpiresAt = "2026-02-14T12:00:00Z",
            Scopes = new List<string> { "upload:all" },
            Storage = "keychain"
        });
        file.Save(FilePath);

        var loaded = SelvaAccountsFile.Load(FilePath);
        Assert.Equal("https://selva.example.com", loaded.ActiveOrigin);
        var account = Assert.Single(loaded.Accounts);
        Assert.Equal(
            ("https://selva.example.com", "ada@example.com", "org-1", "Studio", "2026-02-14T12:00:00Z", "keychain"),
            (account.Origin, account.Email, account.OrgId, account.OrgName, account.ExpiresAt, account.Storage));
        Assert.Equal(new[] { "upload:all" }, account.Scopes);
    }

    [Fact]
    public void Upsert_ReplacesTheRecordForThatOrigin()
    {
        var file = SelvaAccountsFile.Load(FilePath);
        file.Upsert(new SelvaAccountRecord { Origin = "https://a.example", Email = "old@example.com" });
        file.Upsert(new SelvaAccountRecord { Origin = "https://a.example", Email = "new@example.com" });
        Assert.Equal("new@example.com", Assert.Single(file.Accounts).Email);
    }
}
