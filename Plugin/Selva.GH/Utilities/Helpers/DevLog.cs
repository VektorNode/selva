using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Threading;
using Newtonsoft.Json;

namespace Selva.GH.Utilities.Helpers;

/// <summary>
///     The file behind <see cref="DevMode" />: one JSON object per line in <c>selva.log</c>, read by
///     <c>pnpm plugin:logs</c>. Messages carry identifiers, never payloads, like every other log.
/// </summary>
internal static class DevLog
{
    /// <summary>Past this the file moves to <c>selva.log.1</c>, so a long session can't fill the disk.</summary>
    private const long MaxBytes = 20 * 1024 * 1024;

    private static readonly object WriteLock = new object();
    private static readonly int ProcessId = Process.GetCurrentProcess().Id;
    private static readonly string FilePath = Path.Combine(DevMode.Directory, "selva.log");

    /// <summary>Never throws: a log that can't be written must not break what it describes.</summary>
    public static void Write(string level, string message, Exception exception = null)
    {
        try
        {
            var record = new Dictionary<string, object>
            {
                ["t"] = DateTime.UtcNow.ToString("yyyy-MM-ddTHH:mm:ss.fffZ"),
                ["level"] = level,
                ["pid"] = ProcessId,
                ["thread"] = Thread.CurrentThread.ManagedThreadId,
                ["msg"] = message
            };
            if (exception != null)
            {
                record["error"] = new Dictionary<string, object>
                {
                    ["type"] = exception.GetType().FullName,
                    ["message"] = exception.Message,
                    ["stack"] = exception.ToString()
                };
            }

            var line = JsonConvert.SerializeObject(record) + "\n";
            lock (WriteLock)
            {
                Directory.CreateDirectory(DevMode.Directory);
                var file = new FileInfo(FilePath);
                if (file.Exists && file.Length > MaxBytes)
                {
                    File.Copy(FilePath, FilePath + ".1", true);
                    File.Delete(FilePath);
                }

                File.AppendAllText(FilePath, line);
            }
        }
        catch
        {
            // See the summary.
        }
    }
}
