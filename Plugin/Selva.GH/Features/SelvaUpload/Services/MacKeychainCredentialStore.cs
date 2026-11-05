#nullable enable
using System;
using System.Runtime.InteropServices;
using System.Text;

namespace Selva.GH.Features.SelvaUpload.Services;

/// <summary>
///     A generic password in the user's login keychain, through the SecItem API. The keychain
///     encrypts it with the login password, and another app that asks for it gets a prompt first.
///     Called through P/Invoke rather than a NuGet wrapper: a DLL added to the .gha can clash with
///     what Rhino has already loaded.
/// </summary>
internal sealed class MacKeychainCredentialStore : ICredentialStore
{
    private const string SecurityFramework = "/System/Library/Frameworks/Security.framework/Security";
    private const string CoreFoundationFramework =
        "/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation";

    private const int ErrSecSuccess = 0;
    private const int ErrSecItemNotFound = -25300;
    private const int RtldNow = 2;

    public string Kind => "keychain";

    public bool TrySave(string origin, string secret)
    {
        using var scope = new CfScope();
        var query = ItemQuery(scope, origin);
        SecItemDelete(query);

        var label = scope.String($"{CredentialStores.ServiceName} ({SelvaOrigin.DisplayHost(origin)})");
        var data = scope.Data(Encoding.UTF8.GetBytes(secret));
        var attributes = scope.Dictionary(
            (Symbols.Class, Symbols.ClassGenericPassword),
            (Symbols.AttrService, scope.String(CredentialStores.ServiceName)),
            (Symbols.AttrAccount, scope.String(origin)),
            (Symbols.AttrLabel, label),
            (Symbols.ValueData, data));

        return SecItemAdd(attributes, IntPtr.Zero) == ErrSecSuccess;
    }

    public string? Load(string origin)
    {
        using var scope = new CfScope();
        var query = scope.Dictionary(
            (Symbols.Class, Symbols.ClassGenericPassword),
            (Symbols.AttrService, scope.String(CredentialStores.ServiceName)),
            (Symbols.AttrAccount, scope.String(origin)),
            (Symbols.ReturnData, Symbols.BooleanTrue),
            (Symbols.MatchLimit, Symbols.MatchLimitOne));

        var status = SecItemCopyMatching(query, out var result);
        if (status != ErrSecSuccess || result == IntPtr.Zero)
        {
            return null;
        }

        try
        {
            var length = (int)CFDataGetLength(result);
            var bytes = new byte[length];
            Marshal.Copy(CFDataGetBytePtr(result), bytes, 0, length);
            return Encoding.UTF8.GetString(bytes);
        }
        finally
        {
            CFRelease(result);
        }
    }

    public void Delete(string origin)
    {
        using var scope = new CfScope();
        var status = SecItemDelete(ItemQuery(scope, origin));
        if (status != ErrSecSuccess && status != ErrSecItemNotFound)
        {
            throw new InvalidOperationException($"The keychain refused to delete the Selva key (status {status}).");
        }
    }

    private static IntPtr ItemQuery(CfScope scope, string origin)
    {
        return scope.Dictionary(
            (Symbols.Class, Symbols.ClassGenericPassword),
            (Symbols.AttrService, scope.String(CredentialStores.ServiceName)),
            (Symbols.AttrAccount, scope.String(origin)));
    }

    /// <summary>The framework constants are exported globals; dlsym gives their address.</summary>
    private static class Symbols
    {
        private static readonly IntPtr Security = dlopen(SecurityFramework, RtldNow);
        private static readonly IntPtr CoreFoundation = dlopen(CoreFoundationFramework, RtldNow);

        public static readonly IntPtr Class = Read(Security, "kSecClass");
        public static readonly IntPtr ClassGenericPassword = Read(Security, "kSecClassGenericPassword");
        public static readonly IntPtr AttrService = Read(Security, "kSecAttrService");
        public static readonly IntPtr AttrAccount = Read(Security, "kSecAttrAccount");
        public static readonly IntPtr AttrLabel = Read(Security, "kSecAttrLabel");
        public static readonly IntPtr ValueData = Read(Security, "kSecValueData");
        public static readonly IntPtr ReturnData = Read(Security, "kSecReturnData");
        public static readonly IntPtr MatchLimit = Read(Security, "kSecMatchLimit");
        public static readonly IntPtr MatchLimitOne = Read(Security, "kSecMatchLimitOne");
        public static readonly IntPtr BooleanTrue = Read(CoreFoundation, "kCFBooleanTrue");

        // Passed by address: CFDictionaryCreate takes a pointer to the callbacks struct.
        public static readonly IntPtr KeyCallBacks = dlsym(CoreFoundation, "kCFTypeDictionaryKeyCallBacks");
        public static readonly IntPtr ValueCallBacks = dlsym(CoreFoundation, "kCFTypeDictionaryValueCallBacks");

        private static IntPtr Read(IntPtr handle, string name)
        {
            var address = dlsym(handle, name);
            if (address == IntPtr.Zero)
            {
                throw new InvalidOperationException($"Keychain symbol {name} not found.");
            }

            return Marshal.ReadIntPtr(address);
        }
    }

    /// <summary>Releases every CF object made through it.</summary>
    private sealed class CfScope : IDisposable
    {
        private readonly System.Collections.Generic.List<IntPtr> _owned = new();

        public void Dispose()
        {
            foreach (var cf in _owned)
            {
                CFRelease(cf);
            }
        }

        public IntPtr String(string value)
        {
            return Own(CFStringCreateWithCharacters(IntPtr.Zero, value, value.Length));
        }

        public IntPtr Data(byte[] bytes)
        {
            try
            {
                return Own(CFDataCreate(IntPtr.Zero, bytes, bytes.Length));
            }
            finally
            {
                Array.Clear(bytes, 0, bytes.Length);
            }
        }

        public IntPtr Dictionary(params (IntPtr Key, IntPtr Value)[] entries)
        {
            var keys = new IntPtr[entries.Length];
            var values = new IntPtr[entries.Length];
            for (var i = 0; i < entries.Length; i++)
            {
                keys[i] = entries[i].Key;
                values[i] = entries[i].Value;
            }

            return Own(CFDictionaryCreate(IntPtr.Zero, keys, values, entries.Length, Symbols.KeyCallBacks,
                Symbols.ValueCallBacks));
        }

        private IntPtr Own(IntPtr cf)
        {
            if (cf == IntPtr.Zero)
            {
                throw new InvalidOperationException("CoreFoundation couldn't allocate an object.");
            }

            _owned.Add(cf);
            return cf;
        }
    }

    [DllImport(SecurityFramework)]
    private static extern int SecItemAdd(IntPtr attributes, IntPtr result);

    [DllImport(SecurityFramework)]
    private static extern int SecItemCopyMatching(IntPtr query, out IntPtr result);

    [DllImport(SecurityFramework)]
    private static extern int SecItemDelete(IntPtr query);

    [DllImport(CoreFoundationFramework, CharSet = CharSet.Unicode)]
    private static extern IntPtr CFStringCreateWithCharacters(IntPtr allocator, string chars, nint length);

    [DllImport(CoreFoundationFramework)]
    private static extern IntPtr CFDataCreate(IntPtr allocator, byte[] bytes, nint length);

    [DllImport(CoreFoundationFramework)]
    private static extern IntPtr CFDataGetBytePtr(IntPtr data);

    [DllImport(CoreFoundationFramework)]
    private static extern nint CFDataGetLength(IntPtr data);

    [DllImport(CoreFoundationFramework)]
    private static extern IntPtr CFDictionaryCreate(IntPtr allocator, IntPtr[] keys, IntPtr[] values, nint count,
        IntPtr keyCallBacks, IntPtr valueCallBacks);

    [DllImport(CoreFoundationFramework)]
    private static extern void CFRelease(IntPtr cf);

    [DllImport("libSystem.dylib")]
    private static extern IntPtr dlopen(string path, int mode);

    [DllImport("libSystem.dylib")]
    private static extern IntPtr dlsym(IntPtr handle, string symbol);
}
