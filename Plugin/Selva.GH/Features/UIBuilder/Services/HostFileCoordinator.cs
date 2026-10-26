#nullable enable
using System;
using System.Collections.Generic;
using System.IO;
using System.Threading.Tasks;
using Selva.GH.Features.UIBuilder.Services.Communication;
using Selva.GH.Utilities.Helpers;

namespace Selva.GH.Features.UIBuilder.Services;

/// <summary>The native dialogs behind the Rhino panel's saves and picks. Called on the UI thread only.</summary>
internal interface IHostFileDialogs
{
    /// <returns>The chosen path, or null when the user cancelled.</returns>
    string? AskSavePath(string suggestedName);

    /// <param name="extensions">Lower case, without the dot. Empty means any file.</param>
    /// <returns>The chosen path, or null when the user cancelled.</returns>
    string? AskOpenPath(IReadOnlyList<string> extensions);
}

/// <summary>Replies to the one socket that sent the request.</summary>
internal interface IHostFileReply
{
    Task SendAsync(object envelope);

    /// <summary>Sends <paramref name="header" /> and <paramref name="body" /> as one <see cref="HostFileFrame" />.</summary>
    Task SendFileAsync(object header, byte[] body);
}

/// <summary>
///     Saves and picks files for the Rhino panel, whose WebView can't download or show a file
///     picker safely. Every request gets exactly one reply, or the page's promise never settles.
/// </summary>
internal sealed class HostFileCoordinator
{
    private const string BusyMessage = "Close the open file dialog, or finish picking in Rhino, first.";

    private static readonly string[] ImageExtensions =
        { "png", "jpg", "jpeg", "gif", "webp", "bmp", "tif", "tiff", "svg" };

    private readonly IHostFileDialogs _dialogs;
    private readonly ModalGate _gate;
    private readonly long _maxFileBytes;
    private readonly Action<Action> _onUiThread;
    private readonly string _sessionId;

    /// <param name="onUiThread">Queues the action on Rhino's UI thread and returns without waiting for it.</param>
    public HostFileCoordinator(IHostFileDialogs dialogs, ModalGate gate, Action<Action> onUiThread,
        string sessionId, long maxFileBytes)
    {
        _dialogs = dialogs;
        _gate = gate;
        _onUiThread = onUiThread;
        _sessionId = sessionId;
        _maxFileBytes = maxFileBytes;
    }

    private string TooLarge => $"The file is larger than {_maxFileBytes / (1024 * 1024)} MB.";

    // Returns at once: the caller is the transport's dispatch chain, which every socket shares, and
    // a modal dialog on it would hold up cancelSolve.
    public void HandleSave(string requestId, string fileName, ArraySegment<byte> body, IHostFileReply reply)
    {
        if (body.Count > _maxFileBytes)
        {
            Send(reply, SaveResult(requestId, PromptOutcome.Failed, TooLarge));
            return;
        }

        if (!_gate.TryEnter())
        {
            Send(reply, SaveResult(requestId, PromptOutcome.Failed, BusyMessage));
            return;
        }

        _onUiThread(() =>
        {
            string? path;
            try
            {
                path = _dialogs.AskSavePath(fileName);
            }
            catch (Exception ex)
            {
                Logger.Warn($"[HostFiles] Save dialog for {requestId} failed: {ex.GetType().Name}");
                Send(reply, SaveResult(requestId, PromptOutcome.Failed, "Could not open the Save dialog."));
                return;
            }
            finally
            {
                _gate.Exit();
            }

            if (path == null)
            {
                Send(reply, SaveResult(requestId, PromptOutcome.Cancelled, null));
                return;
            }

            _ = WriteAsync(requestId, path, body, reply);
        });
    }

    public void HandlePick(string requestId, IEnumerable<string> accept, IHostFileReply reply)
    {
        if (!_gate.TryEnter())
        {
            Send(reply, PickResult(requestId, PromptOutcome.Failed, BusyMessage));
            return;
        }

        var extensions = AcceptExtensions(accept);
        _onUiThread(() =>
        {
            string? path;
            try
            {
                path = _dialogs.AskOpenPath(extensions);
            }
            catch (Exception ex)
            {
                Logger.Warn($"[HostFiles] Open dialog for {requestId} failed: {ex.GetType().Name}");
                Send(reply, PickResult(requestId, PromptOutcome.Failed, "Could not open the Open dialog."));
                return;
            }
            finally
            {
                _gate.Exit();
            }

            if (path == null)
            {
                Send(reply, PickResult(requestId, PromptOutcome.Cancelled, null));
                return;
            }

            _ = ReadAsync(requestId, path, reply);
        });
    }

    /// <summary>
    ///     An <c>&lt;input accept&gt;</c> list as dialog extensions: <c>.slvp</c> becomes <c>slvp</c>,
    ///     <c>image/*</c> becomes the common image types. Anything else (<c>*</c>, other MIME types)
    ///     means any file: a dialog that hides a file the page would accept is worse than no filter,
    ///     and the page checks what it gets.
    /// </summary>
    internal static IReadOnlyList<string> AcceptExtensions(IEnumerable<string> accept)
    {
        var extensions = new List<string>();
        foreach (var raw in accept)
        {
            var entry = raw.Trim().ToLowerInvariant();
            if (entry.Length > 1 && entry[0] == '.')
            {
                extensions.Add(entry.Substring(1));
            }
            else if (entry == "image/*")
            {
                extensions.AddRange(ImageExtensions);
            }
            else if (entry.Length > 0)
            {
                return Array.Empty<string>();
            }
        }

        return extensions;
    }

    private async Task WriteAsync(string requestId, string path, ArraySegment<byte> body, IHostFileReply reply)
    {
        try
        {
            await Task.Run(() =>
            {
                using var stream = new FileStream(path, FileMode.Create, FileAccess.Write, FileShare.None);
                stream.Write(body.Array!, body.Offset, body.Count);
            }).ConfigureAwait(false);
            await reply.SendAsync(SaveResult(requestId, PromptOutcome.Saved, null)).ConfigureAwait(false);
        }
        catch (Exception ex)
        {
            // The message may hold the path, so it goes to the user only, never the log.
            Logger.Warn($"[HostFiles] Writing {body.Count} bytes for {requestId} failed: {ex.GetType().Name}");
            Send(reply, SaveResult(requestId, PromptOutcome.Failed, $"Could not save the file: {ex.Message}"));
        }
    }

    private async Task ReadAsync(string requestId, string path, IHostFileReply reply)
    {
        try
        {
            var bytes = await Task.Run(() =>
                new FileInfo(path).Length > _maxFileBytes ? null : File.ReadAllBytes(path)).ConfigureAwait(false);
            if (bytes == null)
            {
                Send(reply, PickResult(requestId, PromptOutcome.Failed, TooLarge));
                return;
            }

            await reply.SendFileAsync(OutboundEnvelopes.HostPickedFile(_sessionId, requestId, Path.GetFileName(path)),
                bytes).ConfigureAwait(false);
        }
        catch (Exception ex)
        {
            Logger.Warn($"[HostFiles] Reading the file for {requestId} failed: {ex.GetType().Name}");
            Send(reply, PickResult(requestId, PromptOutcome.Failed, $"Could not read the file: {ex.Message}"));
        }
    }

    private object SaveResult(string requestId, PromptOutcome outcome, string? error)
    {
        return OutboundEnvelopes.HostSaveFileResult(_sessionId, requestId, outcome, error);
    }

    private object PickResult(string requestId, PromptOutcome outcome, string? error)
    {
        return OutboundEnvelopes.HostPickFileResult(_sessionId, requestId, outcome, error);
    }

    private static void Send(IHostFileReply reply, object envelope)
    {
        reply.SendAsync(envelope).ContinueWith(
            t => Logger.Warn($"[HostFiles] Reply failed: {t.Exception?.GetBaseException().GetType().Name}"),
            TaskContinuationOptions.OnlyOnFaulted);
    }
}
