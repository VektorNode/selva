#nullable enable
using System;
using System.Runtime.InteropServices;
using System.Text;
using FILETIME = System.Runtime.InteropServices.ComTypes.FILETIME;

namespace Selva.GH.Features.SelvaUpload.Services;

/// <summary>
///     A generic credential in Windows Credential Manager, encrypted with the user's login.
///     CRED_PERSIST_LOCAL_MACHINE so it stays on this machine instead of roaming with the profile.
///     Any process running as the user can read it without a prompt; that's Windows' model.
/// </summary>
internal sealed class WindowsCredentialStore : ICredentialStore
{
    private const int CredTypeGeneric = 1;
    private const int CredPersistLocalMachine = 2;
    private const int ErrorNotFound = 1168;

    public string Kind => "keychain";

    public bool TrySave(string origin, string secret)
    {
        var blob = Encoding.UTF8.GetBytes(secret);
        var blobPtr = Marshal.AllocHGlobal(blob.Length);
        try
        {
            Marshal.Copy(blob, 0, blobPtr, blob.Length);
            var credential = new Credential
            {
                Type = CredTypeGeneric,
                TargetName = Target(origin),
                UserName = origin,
                Comment = CredentialStores.ServiceName,
                CredentialBlobSize = blob.Length,
                CredentialBlob = blobPtr,
                Persist = CredPersistLocalMachine
            };
            return CredWrite(ref credential, 0);
        }
        finally
        {
            for (var i = 0; i < blob.Length; i++)
            {
                Marshal.WriteByte(blobPtr, i, 0);
            }

            Marshal.FreeHGlobal(blobPtr);
        }
    }

    public string? Load(string origin)
    {
        if (!CredRead(Target(origin), CredTypeGeneric, 0, out var credentialPtr))
        {
            return null;
        }

        try
        {
            var credential = Marshal.PtrToStructure<Credential>(credentialPtr);
            if (credential.CredentialBlob == IntPtr.Zero || credential.CredentialBlobSize == 0)
            {
                return null;
            }

            var blob = new byte[credential.CredentialBlobSize];
            Marshal.Copy(credential.CredentialBlob, blob, 0, blob.Length);
            return Encoding.UTF8.GetString(blob);
        }
        finally
        {
            CredFree(credentialPtr);
        }
    }

    public void Delete(string origin)
    {
        if (!CredDelete(Target(origin), CredTypeGeneric, 0) && Marshal.GetLastWin32Error() != ErrorNotFound)
        {
            throw new InvalidOperationException(
                $"Windows refused to delete the stored Selva key (error {Marshal.GetLastWin32Error()}).");
        }
    }

    private static string Target(string origin) => $"{CredentialStores.ServiceName}:{origin}";

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct Credential
    {
        public int Flags;
        public int Type;
        public string? TargetName;
        public string? Comment;
        public FILETIME LastWritten;
        public int CredentialBlobSize;
        public IntPtr CredentialBlob;
        public int Persist;
        public int AttributeCount;
        public IntPtr Attributes;
        public string? TargetAlias;
        public string? UserName;
    }

    [DllImport("advapi32.dll", EntryPoint = "CredWriteW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CredWrite(ref Credential credential, int flags);

    [DllImport("advapi32.dll", EntryPoint = "CredReadW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CredRead(string target, int type, int flags, out IntPtr credential);

    [DllImport("advapi32.dll", EntryPoint = "CredDeleteW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CredDelete(string target, int type, int flags);

    [DllImport("advapi32.dll")]
    private static extern void CredFree(IntPtr buffer);
}
