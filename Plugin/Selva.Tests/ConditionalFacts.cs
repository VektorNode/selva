using System.Runtime.InteropServices;

namespace Selva.Tests;

// xunit 2 has no Assert.Skip: a test that returns early reports Passed with nothing checked. These
// set Skip when the test can't run here, so the run lists it as skipped instead.

public sealed class WindowsFactAttribute : FactAttribute
{
    public WindowsFactAttribute()
    {
        if (!OperatingSystem.IsWindows())
        {
            Skip = "Needs Windows.";
        }
    }
}

public sealed class NotWindowsFactAttribute : FactAttribute
{
    public NotWindowsFactAttribute()
    {
        if (OperatingSystem.IsWindows())
        {
            Skip = "Checks behaviour off Windows.";
        }
    }
}

public sealed class OsCredentialStoreFactAttribute : FactAttribute
{
    public OsCredentialStoreFactAttribute()
    {
        if (!(RuntimeInformation.IsOSPlatform(OSPlatform.OSX) || RuntimeInformation.IsOSPlatform(OSPlatform.Windows)))
        {
            Skip = "Needs the macOS keychain or Windows Credential Manager.";
        }
        else if (Environment.GetEnvironmentVariable("SELVA_CREDENTIAL_STORE_TEST") != "1")
        {
            Skip = "Writes to the real OS credential store: set SELVA_CREDENTIAL_STORE_TEST=1 to run.";
        }
    }
}

/// <summary>Skipped where this process can't create a symbolic link (Windows without Developer Mode).</summary>
public sealed class SymlinkFactAttribute : FactAttribute
{
    private static readonly bool CanCreateSymlinks = ProbeSymlinks();

    public SymlinkFactAttribute()
    {
        if (!CanCreateSymlinks)
        {
            Skip = "This process can't create symbolic links.";
        }
    }

    private static bool ProbeSymlinks()
    {
        var link = Path.Combine(Path.GetTempPath(), "selva-symlink-probe-" + Guid.NewGuid());
        try
        {
            File.CreateSymbolicLink(link, link + ".target");
            return true;
        }
        catch (Exception ex) when (ex is IOException || ex is UnauthorizedAccessException)
        {
            return false;
        }
        finally
        {
            File.Delete(link);
        }
    }
}
