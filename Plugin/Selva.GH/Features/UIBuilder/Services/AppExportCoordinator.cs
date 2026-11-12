using System;
using System.Threading.Tasks;
using Grasshopper.Kernel;
using Selva.AppFormat;
using Selva.GH.Features.UIBuilder.Services.Communication;
using Selva.GH.Utilities.Helpers;
using Selva.RhinoPanel;
using Selva.Schema.Models;

namespace Selva.GH.Features.UIBuilder.Services;

/// <summary>
///     Answers the builder's `exportApp` for one UI Bridge: packs the open document as a Selva app
///     file and sends it to the page that asked, which saves it. Every request gets exactly one
///     reply, or the page's promise never settles. The key is used here once and never kept.
/// </summary>
public sealed class AppExportCoordinator : IDisposable
{
    private readonly string _sessionId;
    private readonly WebSocketTransport _transport;

    private GH_Component _component;
    private bool _disposed;
    private Func<UISchema> _getSchema;

    public AppExportCoordinator(WebSocketTransport transport, string sessionId)
    {
        _transport = transport ?? throw new ArgumentNullException(nameof(transport));
        _sessionId = sessionId ?? throw new ArgumentNullException(nameof(sessionId));
    }

    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _transport.OnExportAppRequested -= HandleExport;
    }

    public void Initialize(GH_Component component, Func<UISchema> getSchema)
    {
        _component = component ?? throw new ArgumentNullException(nameof(component));
        _getSchema = getSchema ?? throw new ArgumentNullException(nameof(getSchema));

        _transport.OnExportAppRequested += HandleExport;
    }

    private void HandleExport(object sender, WebSocketTransport.ExportAppRequest request)
    {
        if (!DevInstall.HasSelvaApp)
        {
            Fail(request, "Export as app isn't available in this version of Selva.");
            return;
        }

        byte[] definition;
        try
        {
            var document = _component.OnPingDocument();
            if (document == null)
            {
                Fail(request, "The definition isn't open in Grasshopper.");
                return;
            }

            if (_getSchema() == null)
            {
                Fail(request, "Save a schema in the builder first: the app shows it.");
                return;
            }

            definition = DefinitionArchive.Serialize(document);
        }
        catch (Exception ex)
        {
            Logger.Warn($"[App export] Serialising for {request.Message.RequestId} failed: {ex.GetType().Name}");
            Fail(request, "Grasshopper couldn't serialise the definition.");
            return;
        }

        // Off the UI thread: deriving the file key from the typed one is slow on purpose.
        _ = Task.Run(() => PackAndSendAsync(request, definition));
    }

    private async Task PackAndSendAsync(WebSocketTransport.ExportAppRequest request, byte[] definition)
    {
        var message = request.Message;
        try
        {
            var file = AppFileCipher.Pack(message.AppName, message.AppIcon, AppDefinitionKind.Binary, definition,
                message.AppKey);
            await request.SendFile(OutboundEnvelopes.ExportedApp(_sessionId, message.RequestId), file)
                .ConfigureAwait(false);
        }
        catch (Exception ex)
        {
            // The type only: the message may quote the name.
            Logger.Warn($"[App export] Packing for {message.RequestId} failed: {ex.GetType().Name}");
            Fail(request, "Could not export the app.");
        }
    }

    private void Fail(WebSocketTransport.ExportAppRequest request, string error)
    {
        request.Reply(OutboundEnvelopes.ExportAppFailed(_sessionId, request.Message.RequestId, error))
            .ContinueWith(
                t => Logger.Warn($"[App export] Reply failed: {t.Exception?.GetBaseException().GetType().Name}"),
                TaskContinuationOptions.OnlyOnFaulted);
    }
}
