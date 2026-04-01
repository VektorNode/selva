using System;
using Selva.GH.Features.UIBuilder.Services.Communication;
using Selva.GH.Features.UIBuilder.Services.Events;
using Selva.GH.Features.UIBuilder.Services.Persistence;
using Selva.GH.Features.UIBuilder.Services.Schema;
using Selva.GH.Features.UIBuilder.Services.State;
using Selva.GH.Features.UIBuilder.Services.Values;
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

    public SchemaManager SchemaManager { get; private set; }
    public ValueApplicator ValueApplicator { get; private set; }
    public ValueCollector ValueCollector { get; private set; }
    public ComponentStateManager StateManager { get; private set; }
    public CommunicationHandler CommunicationHandler { get; private set; }
    public LocalWebServer WebServer { get; private set; }
    public DocumentEventManager EventManager { get; private set; }
    public SchemaCleanupService CleanupService { get; private set; }

    // New services
    public SchemaPersistenceService PersistenceService { get; private set; }
    public ServerLifecycleManager ServerManager { get; private set; }
    public BridgeCommunicationService BridgeService { get; private set; }
    public DocumentSynchronizationService DocumentSyncService { get; private set; }

    public string SessionId { get; }
    public Version PluginVersion { get; }

    public void Dispose()
    {
        BridgeService?.Dispose();
        DocumentSyncService?.Dispose();
        ServerManager?.Dispose();
        CommunicationHandler?.Dispose();
        WebServer?.Dispose();
        EventManager?.Dispose();
    }

    private void InitializeServices()
    {
        // Core services
        SchemaManager = new SchemaManager(SessionId);
        ValueApplicator = new ValueApplicator();
        ValueCollector = new ValueCollector();
        StateManager = new ComponentStateManager();
        CommunicationHandler = new CommunicationHandler(SessionId);

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

        EventManager = new DocumentEventManager(SchemaManager, ValueCollector, CommunicationHandler);
        CleanupService = new SchemaCleanupService();

        // New services
        PersistenceService = new SchemaPersistenceService(PluginVersion);
        ServerManager = new ServerLifecycleManager(WebServer, CommunicationHandler);
        BridgeService = new BridgeCommunicationService(
            CommunicationHandler,
            SchemaManager,
            ValueApplicator,
            ValueCollector,
            StateManager,
            EventManager,
            PluginVersion,
            SessionId
        );
        DocumentSyncService = new DocumentSynchronizationService(
            EventManager,
            SchemaManager,
            CommunicationHandler,
            CleanupService
        );
    }
}
