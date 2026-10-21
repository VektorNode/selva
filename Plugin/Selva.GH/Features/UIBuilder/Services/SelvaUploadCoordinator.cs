using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Threading;
using System.Threading.Tasks;
using GH_IO.Serialization;
using Grasshopper;
using Grasshopper.Kernel;
using Rhino;
using Rhino.UI;
using Selva.Schema.Models;
using Selva.GH.Features.SelvaUpload.Services;
using Selva.GH.Features.UIBuilder.Helpers;
using Selva.GH.Features.UIBuilder.Services.Communication;
using Selva.GH.Utilities.Helpers;

namespace Selva.GH.Features.UIBuilder.Services;

/// <summary>
///     Answers the web UI's selva* commands for one UI Bridge: sign-in through the shared account
///     manager, the upload targets, and the upload of the open document. The page asks; this acts.
///     No key ever goes back over the bridge.
/// </summary>
public sealed class SelvaUploadCoordinator : IDisposable
{
    private static readonly Version PluginVersion = typeof(SelvaUploadCoordinator).Assembly.GetName().Version;

    private static readonly Lazy<SelvaAccountManager> SharedAccounts = new(() => new SelvaAccountManager(
        CredentialStores.ForThisMachine(),
        Path.Combine(Folders.AppDataFolder, "Selva", "selva-accounts.json"),
        SelvaApiClient.CreateHandler,
        UserAgent(),
        OpenInBrowser));

    private readonly WebSocketTransport _transport;
    private readonly object _uploadLock = new();

    private SelvaAccountManager _accounts;
    private GH_Component _component;
    private bool _disposed;
    private Func<List<SelvaDefinitionLink>> _getLinks;
    private Func<UISchema> _getSchema;
    private Action<List<SelvaDefinitionLink>> _setLinks;
    private CancellationTokenSource _upload;

    public SelvaUploadCoordinator(WebSocketTransport transport)
    {
        _transport = transport ?? throw new ArgumentNullException(nameof(transport));
    }

    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _transport.OnSelvaCommand -= HandleCommand;
        if (_accounts != null)
        {
            _accounts.Changed -= BroadcastAccount;
        }

        lock (_uploadLock)
        {
            _upload?.Cancel();
        }
    }

    public void Initialize(
        GH_Component component,
        Func<UISchema> getSchema,
        Func<List<SelvaDefinitionLink>> getLinks,
        Action<List<SelvaDefinitionLink>> setLinks)
    {
        _component = component ?? throw new ArgumentNullException(nameof(component));
        _getSchema = getSchema ?? throw new ArgumentNullException(nameof(getSchema));
        _getLinks = getLinks ?? throw new ArgumentNullException(nameof(getLinks));
        _setLinks = setLinks ?? throw new ArgumentNullException(nameof(setLinks));

        _transport.OnSelvaCommand += HandleCommand;
    }

    // The manager reads the accounts file and may touch the keychain, so it's built on first use,
    // not when a UI Bridge is placed.
    private SelvaAccountManager Accounts()
    {
        if (_accounts == null)
        {
            _accounts = SharedAccounts.Value;
            _accounts.Changed += BroadcastAccount;
        }

        return _accounts;
    }

    // ==========================================================================
    // Commands
    // ==========================================================================

    private void HandleCommand(object sender, InboundMessage message)
    {
        switch (message.Kind)
        {
            case InboundKind.SelvaGetAccount:
                RunAccount(_ => Task.CompletedTask);
                break;
            case InboundKind.SelvaConnect:
                RunAccount(ct => Accounts().ConnectAsync(message.Origin, ct));
                break;
            case InboundKind.SelvaSignIn:
                RunAccount(ct => Accounts().SignInAsync(ct));
                break;
            case InboundKind.SelvaUseApiKey:
                RhinoApp.InvokeOnUiThread(new Action(PromptForApiKey));
                break;
            case InboundKind.SelvaSignOut:
                RunAccount(ct => Accounts().SignOutAsync(ct));
                break;
            case InboundKind.SelvaListTargets:
                Run(ListTargetsAsync);
                break;
            case InboundKind.SelvaUpload:
                StartUpload(message.UploadRequest);
                break;
            case InboundKind.SelvaCancel:
                Accounts().Cancel();
                lock (_uploadLock)
                {
                    _upload?.Cancel();
                }

                break;
        }
    }

    private void PromptForApiKey()
    {
        var origin = Accounts().Snapshot().Origin;
        string key = null;
        if (origin != null)
        {
            using var dialog = new ApiKeyDialog(SelvaOrigin.DisplayHost(origin));
            dialog.UseRhinoStyle();
            key = dialog.ShowModal(Instances.EtoDocumentEditor ?? RhinoEtoApp.MainWindow);
        }

        // Without an address the manager says so; a cancelled dialog just re-sends the account.
        RunAccount(ct => origin == null || !string.IsNullOrWhiteSpace(key)
            ? Accounts().UseApiKeyAsync(key ?? string.Empty, ct)
            : Task.CompletedTask);
    }

    private async Task ListTargetsAsync(CancellationToken cancellationToken)
    {
        var session = Accounts().Session();
        if (session == null)
        {
            BroadcastAccount();
            return;
        }

        var capture = await OnUiThread(CaptureDocument).ConfigureAwait(false);
        var defaults = Defaults(capture);
        var file = new SelvaUploadFile { Name = capture.FileName, SizeBytes = capture.Bytes?.Length ?? 0 };

        SelvaTargets targets;
        try
        {
            using var client = Client(session);
            targets = await new SelvaUploadService(client, session.Record.UserId, session.Record.OrgId)
                .ListTargetsAsync(SelvaDefinitionLinks.For(capture.Links, session.Origin), capture.DocumentId,
                    defaults, file, cancellationToken)
                .ConfigureAwait(false);
        }
        catch (SelvaApiException ex) when (ex.InvalidToken)
        {
            SignInEnded(session.Origin);
            return;
        }
        catch (SelvaApiException ex)
        {
            targets = new SelvaTargets
            {
                Origin = session.Origin,
                Projects = new List<SelvaProject>(),
                Matches = new List<SelvaVersionTarget>(),
                Defaults = defaults,
                File = file,
                BlockedReason = ex.Message
            };
        }

        targets.BlockedReason ??= capture.BlockedReason;
        _ = _transport.BroadcastSelvaTargets(targets);
    }

    private void StartUpload(SelvaUploadRequest request)
    {
        CancellationTokenSource upload;
        lock (_uploadLock)
        {
            if (_upload != null)
            {
                _ = _transport.BroadcastSelvaUploadResult(new SelvaUploadResult
                    { Ok = false, Error = "An upload is already running." });
                return;
            }

            upload = _upload = new CancellationTokenSource();
        }

        _ = Task.Run(async () =>
        {
            try
            {
                var result = await UploadAsync(request, upload.Token).ConfigureAwait(false);
                _ = _transport.BroadcastSelvaUploadResult(result);
            }
            catch (Exception ex)
            {
                Logger.Error("[Selva upload] Upload failed", ex);
                _ = _transport.BroadcastSelvaUploadResult(new SelvaUploadResult { Ok = false, Error = ex.Message });
            }
            finally
            {
                lock (_uploadLock)
                {
                    _upload = null;
                }

                upload.Dispose();
            }
        });
    }

    private async Task<SelvaUploadResult> UploadAsync(SelvaUploadRequest request, CancellationToken cancellationToken)
    {
        var session = Accounts().Session();
        if (session == null)
        {
            BroadcastAccount();
            return new SelvaUploadResult { Ok = false, Error = "Sign in to Selva first." };
        }

        _ = _transport.BroadcastSelvaUploadProgress("preparing");
        var capture = await OnUiThread(CaptureDocument).ConfigureAwait(false);
        if (capture.BlockedReason != null)
        {
            return new SelvaUploadResult { Ok = false, Error = capture.BlockedReason };
        }

        try
        {
            using var client = Client(session);
            var (result, link) = await new SelvaUploadService(client, session.Record.UserId, session.Record.OrgId)
                .UploadAsync(request, capture.Bytes, capture.FileName,
                    stage => _ = _transport.BroadcastSelvaUploadProgress(stage), cancellationToken)
                .ConfigureAwait(false);

            if (link != null)
            {
                await OnUiThread(() =>
                {
                    _setLinks(SelvaDefinitionLinks.With(_getLinks(), link));
                    _component.OnPingDocument()?.Modified();
                    return true;
                }).ConfigureAwait(false);
            }

            return result;
        }
        catch (SelvaApiException ex) when (ex.InvalidToken)
        {
            SignInEnded(session.Origin);
            return new SelvaUploadResult { Ok = false, Error = "Your sign-in to Selva ended. Sign in again." };
        }
    }

    // ==========================================================================
    // The document
    // ==========================================================================

    private sealed class DocumentCapture
    {
        public byte[] Bytes;
        public string FileName = "definition.gh";
        public string DocumentId;
        public UISchema Schema;
        public List<SelvaDefinitionLink> Links = new();
        public string BlockedReason;
    }

    /// <summary>
    ///     Runs on the UI thread: the document is serialised in memory, so unsaved canvas changes go
    ///     up and the file on disk isn't touched.
    /// </summary>
    private DocumentCapture CaptureDocument()
    {
        var capture = new DocumentCapture { Links = _getLinks() ?? new List<SelvaDefinitionLink>() };
        var document = _component.OnPingDocument();
        if (document == null)
        {
            capture.BlockedReason = "The definition isn't open in Grasshopper.";
            return capture;
        }

        capture.Schema = _getSchema();
        capture.DocumentId = document.DocumentID.ToString();
        capture.FileName = FileName(document);
        if (capture.Schema == null)
        {
            capture.BlockedReason = "Save a schema in the builder first: Selva reads it from the file.";
            return capture;
        }

        capture.Bytes = Serialize(document);
        return capture;
    }

    /// <summary>
    ///     The links are dropped from the copy that's uploaded: they name every instance this file
    ///     went to, which users of this one have no need to see.
    /// </summary>
    private static byte[] Serialize(GH_Document document)
    {
        var archive = new GH_Archive();
        archive.CreateNewRoot(true);
        if (!archive.AppendObject(document, "Definition"))
        {
            throw new InvalidOperationException("Grasshopper couldn't serialise the definition.");
        }

        RemoveLinks(archive.GetRootNode);
        return archive.Serialize_Binary();
    }

    private static void RemoveLinks(GH_Chunk chunk)
    {
        if (chunk.ItemExists(SelvaDefinitionLinks.ArchiveItem))
        {
            chunk.RemoveItem(SelvaDefinitionLinks.ArchiveItem);
        }

        foreach (var child in chunk.Chunks.OfType<GH_Chunk>())
        {
            RemoveLinks(child);
        }
    }

    private static string FileName(GH_Document document)
    {
        var name = !string.IsNullOrEmpty(document.FilePath)
            ? Path.GetFileNameWithoutExtension(document.FilePath)
            : document.DisplayName;
        var invalid = Path.GetInvalidFileNameChars();
        var cleaned = new string((name ?? string.Empty).Where(c => !invalid.Contains(c) && c != '*').ToArray())
            .Trim();
        return (string.IsNullOrEmpty(cleaned) ? "definition" : cleaned) + ".gh";
    }

    private static SelvaDefinitionDefaults Defaults(DocumentCapture capture)
    {
        var schema = capture.Schema;
        return new SelvaDefinitionDefaults
        {
            DisplayName = !string.IsNullOrWhiteSpace(schema?.Name)
                ? schema.Name
                : Path.GetFileNameWithoutExtension(capture.FileName),
            Description = schema?.Description,
            Category = schema?.Category,
            Tags = schema?.Tags?.ToList() ?? new List<string>()
        };
    }

    // ==========================================================================
    // Helpers
    // ==========================================================================

    private void BroadcastAccount()
    {
        if (!_disposed)
        {
            _ = _transport.BroadcastSelvaAccount(Accounts().Snapshot());
        }
    }

    private void SignInEnded(string origin)
    {
        Accounts().Forget(origin,
            $"Your sign-in to {SelvaOrigin.DisplayHost(origin)} ended: it ran out or was revoked. Sign in again.");
    }

    private static SelvaApiClient Client(SelvaSession session)
    {
        return new SelvaApiClient(session.Origin, session.Token, UserAgent(), SelvaApiClient.CreateHandler());
    }

    /// <summary>The page waits for a selvaAccount after every account command, so one always follows.</summary>
    private void RunAccount(Func<CancellationToken, Task> work)
    {
        Run(async ct =>
        {
            try
            {
                await work(ct).ConfigureAwait(false);
            }
            finally
            {
                BroadcastAccount();
            }
        });
    }

    private static void Run(Func<CancellationToken, Task> work)
    {
        _ = Task.Run(async () =>
        {
            try
            {
                await work(CancellationToken.None).ConfigureAwait(false);
            }
            catch (Exception ex)
            {
                Logger.Error("[Selva upload] Command failed", ex);
            }
        });
    }

    private static Task<T> OnUiThread<T>(Func<T> work)
    {
        var completion = new TaskCompletionSource<T>(TaskCreationOptions.RunContinuationsAsynchronously);
        RhinoApp.InvokeOnUiThread(new Action(() =>
        {
            try
            {
                completion.SetResult(work());
            }
            catch (Exception ex)
            {
                completion.SetException(ex);
            }
        }));
        return completion.Task;
    }

    /// <summary>Lets Selva refuse plugin versions it knows are broken.</summary>
    private static string UserAgent()
    {
        var os = RuntimeInformation.IsOSPlatform(OSPlatform.Windows) ? "Windows"
            : RuntimeInformation.IsOSPlatform(OSPlatform.OSX) ? "macOS"
            : "other";
        return $"Selva-Grasshopper/{PluginVersion} (Rhino {RhinoApp.Version}; {os})";
    }

    /// <summary>
    ///     Only https on the instance, or http on loopback, is ever opened: on Windows the shell would
    ///     run whatever handler a URL's scheme is registered to.
    /// </summary>
    private static void OpenInBrowser(string url)
    {
        if (!Uri.TryCreate(url, UriKind.Absolute, out var uri) ||
            !(uri.Scheme == Uri.UriSchemeHttps ||
              (uri.Scheme == Uri.UriSchemeHttp && SelvaOrigin.IsLoopbackHost(uri.Host))))
        {
            throw new InvalidOperationException("Refused to open a URL that isn't on the Selva instance.");
        }

        Process.Start(new ProcessStartInfo { FileName = uri.AbsoluteUri, UseShellExecute = true });
    }
}
