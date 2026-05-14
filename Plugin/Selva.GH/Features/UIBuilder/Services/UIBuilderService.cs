using System;
using Selva.GH.Features.UIBuilder.Services.Communication;
using Selva.GH.Features.UIBuilder.Services.Schema;
using Selva.GH.Utilities.Helpers;

namespace Selva.GH.Features.UIBuilder.Services;

public class UIBuilderService : IDisposable
{
    public UIBuilderService(string sessionId, Version pluginVersion)
    {
        SessionId = sessionId;
        PluginVersion = pluginVersion;
        InitializeServices();
    }

    public SchemaSynchronizer SchemaSynchronizer { get; private set; }
    public ValueApplicator ValueApplicator { get; private set; }
    public ValueCollector ValueCollector { get; private set; }
    public ComponentStateManager StateManager { get; private set; }
    public WebSocketTransport WebSocketTransport { get; private set; }
    public LocalWebServer WebServer { get; private set; }
    public DocumentEventManager EventManager { get; private set; }
    public SchemaCleanupService CleanupService { get; private set; }

    // New services
    public SchemaArchiveSerializer PersistenceService { get; private set; }
    public ServerLifecycleManager ServerManager { get; private set; }
    public BridgeOrchestrator BridgeService { get; private set; }
    public DocumentSynchronizationService DocumentSyncService { get; private set; }

    public string SessionId { get; }
    public Version PluginVersion { get; }

    public void Dispose()
    {
        BridgeService?.Dispose();
        DocumentSyncService?.Dispose();
        ServerManager?.Dispose();
        WebSocketTransport?.Dispose();
        WebServer?.Dispose();
        EventManager?.Dispose();
    }

    private void InitializeServices()
    {
        // Core services
        SchemaSynchronizer = new SchemaSynchronizer(SessionId);
        ValueApplicator = new ValueApplicator();
        ValueCollector = new ValueCollector();
        StateManager = new ComponentStateManager();
        WebSocketTransport = new WebSocketTransport(SessionId);

        // Only create LocalWebServer on Windows (HttpListener doesn't work on Linux)
        if (System.Runtime.InteropServices.RuntimeInformation.IsOSPlatform(
            System.Runtime.InteropServices.OSPlatform.Windows))
        {
            WebServer = new LocalWebServer();
        }
        else
        {
            WebServer = null;
            Logger.Warn("[UIBuilderService] LocalWebServer skipped on non-Windows platform");
        }

        EventManager = new DocumentEventManager(SchemaSynchronizer, ValueCollector, WebSocketTransport);
        CleanupService = new SchemaCleanupService();

        // New services
        PersistenceService = new SchemaArchiveSerializer(PluginVersion);
        ServerManager = new ServerLifecycleManager(WebServer, WebSocketTransport);
        BridgeService = new BridgeOrchestrator(
            WebSocketTransport,
            SchemaSynchronizer,
            ValueApplicator,
            ValueCollector,
            StateManager,
            EventManager,
            PluginVersion,
            SessionId
        );
        DocumentSyncService = new DocumentSynchronizationService(
            EventManager,
            SchemaSynchronizer,
            WebSocketTransport,
            CleanupService
        );
    }
}
