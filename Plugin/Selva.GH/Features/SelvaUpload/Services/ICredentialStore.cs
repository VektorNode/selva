#nullable enable
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

namespace Selva.GH.Features.SelvaUpload.Services;

/// <summary>
///     Where a Selva key is kept, one per instance origin. Only the key goes here; everything about
///     the account that isn't secret goes in <see cref="SelvaAccountsFile" />.
/// </summary>
public interface ICredentialStore
{
    /// <summary>"keychain" for an OS store, "memory" for one that forgets when Rhino closes.</summary>
    string Kind { get; }

    /// <summary>False when the OS refused; the caller falls back to memory and says so.</summary>
    bool TrySave(string origin, string secret);

    string? Load(string origin);

    void Delete(string origin);
}

public static class CredentialStores
{
    /// <summary>The OS store on Windows and macOS; memory anywhere else.</summary>
    public static ICredentialStore ForThisMachine()
    {
        if (RuntimeInformation.IsOSPlatform(OSPlatform.Windows))
        {
            return new GuardedCredentialStore(new WindowsCredentialStore());
        }

        if (RuntimeInformation.IsOSPlatform(OSPlatform.OSX))
        {
            return new GuardedCredentialStore(new MacKeychainCredentialStore());
        }

        return new MemoryCredentialStore();
    }

    /// <summary>Shown in Credential Manager and Keychain Access next to the instance's origin.</summary>
    internal const string ServiceName = "Selva for Grasshopper";
}

public sealed class MemoryCredentialStore : ICredentialStore
{
    private readonly Dictionary<string, string> _secrets = new();
    private readonly object _lock = new();

    public string Kind => "memory";

    public bool TrySave(string origin, string secret)
    {
        lock (_lock)
        {
            _secrets[origin] = secret;
        }

        return true;
    }

    public string? Load(string origin)
    {
        lock (_lock)
        {
            return _secrets.TryGetValue(origin, out var secret) ? secret : null;
        }
    }

    public void Delete(string origin)
    {
        lock (_lock)
        {
            _secrets.Remove(origin);
        }
    }
}

/// <summary>
///     An OS store that fails reads as "nothing stored" and writes as "not saved", so a missing
///     framework or a refused keychain leaves the user signed in for this session instead of broken.
/// </summary>
internal sealed class GuardedCredentialStore : ICredentialStore
{
    private readonly ICredentialStore _inner;

    public GuardedCredentialStore(ICredentialStore inner)
    {
        _inner = inner;
    }

    public string Kind => _inner.Kind;

    public bool TrySave(string origin, string secret)
    {
        try
        {
            return _inner.TrySave(origin, secret);
        }
        catch (Exception ex) when (IsPlatformFailure(ex))
        {
            return false;
        }
    }

    public string? Load(string origin)
    {
        try
        {
            return _inner.Load(origin);
        }
        catch (Exception ex) when (IsPlatformFailure(ex))
        {
            return null;
        }
    }

    public void Delete(string origin)
    {
        try
        {
            _inner.Delete(origin);
        }
        catch (Exception ex) when (IsPlatformFailure(ex))
        {
            // Left behind in the OS store; the accounts file no longer points at it.
        }
    }

    private static bool IsPlatformFailure(Exception ex)
    {
        return ex is DllNotFoundException || ex is EntryPointNotFoundException ||
               ex is TypeInitializationException || ex is InvalidOperationException;
    }
}
