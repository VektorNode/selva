using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using Newtonsoft.Json;
using Rhino;
using Selva.GH.Utilities.Helpers;

namespace Selva.GH.Features.UIBuilder.Services;

/// <summary>
///     One file per live bridge session in <c>dev/sessions/</c>, holding the full session URL with its
///     secret, so <c>lab:record</c>, <c>bridge-drive</c> and an agent can join without a URL copied out
///     of Rhino. Dev mode only: the secret on disk is acceptable because a developer opted in, but it
///     must not outlive the session: files go when the component cleans up, when Rhino closes, and a
///     file left by a crashed Rhino (dead pid) goes at the next start.
/// </summary>
internal static class DevSessions
{
    private static readonly object WriteLock = new object();
    private static readonly int ProcessId = Process.GetCurrentProcess().Id;
    private static readonly string Folder = Path.Combine(DevMode.Directory, "sessions");

    /// <summary>The last URL written per session, so a re-solve doesn't rewrite an unchanged file.</summary>
    private static readonly Dictionary<string, string> Published = new Dictionary<string, string>();

    private static bool _started;

    public static void Publish(string sessionId, string url, int wsPort, string role, string document)
    {
        if (!DevMode.Enabled || sessionId == null || url == null)
        {
            return;
        }

        try
        {
            lock (WriteLock)
            {
                if (Published.TryGetValue(sessionId, out var previous) && previous == url)
                {
                    return;
                }

                Directory.CreateDirectory(Folder);
                StartOnce();
                var path = Path.Combine(Folder, sessionId + ".json");
                var temp = path + ".tmp";
                File.WriteAllText(temp, JsonConvert.SerializeObject(new Dictionary<string, object>
                {
                    ["sessionId"] = sessionId,
                    ["url"] = url,
                    ["wsPort"] = wsPort,
                    ["role"] = role,
                    ["document"] = document,
                    ["pid"] = ProcessId,
                    ["rhino"] = RhinoApp.Version.ToString(),
                    ["startedAt"] = DateTime.UtcNow.ToString("o")
                }, Formatting.Indented));
                File.Copy(temp, path, true);
                File.Delete(temp);
                Published[sessionId] = url;
            }

            Logger.Trace($"[session {sessionId}] published on ws:{wsPort} as {role} for '{document}'");
        }
        catch (Exception ex)
        {
            Logger.Warn($"[DevSessions] Could not write the session file: {ex.Message}");
        }
    }

    public static void Remove(string sessionId)
    {
        if (!DevMode.Enabled || sessionId == null)
        {
            return;
        }

        try
        {
            lock (WriteLock)
            {
                Published.Remove(sessionId);
                File.Delete(Path.Combine(Folder, sessionId + ".json"));
            }

            Logger.Trace($"[session {sessionId}] closed");
        }
        catch
        {
            // A leftover file names this process; RemoveAll or the next start's sweep gets it.
        }
    }

    /// <summary>Caller holds <see cref="WriteLock" />.</summary>
    private static void StartOnce()
    {
        if (_started)
        {
            return;
        }

        _started = true;
        RemoveStale();
        // Dispose doesn't reliably run on exit, and a file that survives it keeps the secret.
        RhinoApp.Closing += (_, _) => RemoveAll();
        AppDomain.CurrentDomain.ProcessExit += (_, _) => RemoveAll();
    }

    private static void RemoveAll()
    {
        lock (WriteLock)
        {
            foreach (var sessionId in Published.Keys)
            {
                try
                {
                    File.Delete(Path.Combine(Folder, sessionId + ".json"));
                }
                catch
                {
                    // Best effort on the way out.
                }
            }

            Published.Clear();
        }
    }

    /// <summary>Deletes files whose Rhino is gone, so a crash doesn't leave a secret behind.</summary>
    private static void RemoveStale()
    {
        foreach (var path in Directory.GetFiles(Folder, "*.json"))
        {
            try
            {
                var fields = JsonConvert.DeserializeObject<Dictionary<string, object>>(File.ReadAllText(path));
                var pid = fields != null && fields.TryGetValue("pid", out var raw) ? Convert.ToInt32(raw) : -1;
                if (pid == ProcessId || IsRunning(pid))
                {
                    continue;
                }

                File.Delete(path);
            }
            catch
            {
                // Unreadable or locked: leave it for the next sweep.
            }
        }
    }

    private static bool IsRunning(int pid)
    {
        if (pid <= 0)
        {
            return false;
        }

        try
        {
            using var process = Process.GetProcessById(pid);
            return !process.HasExited;
        }
        catch (ArgumentException)
        {
            return false;
        }
    }
}
