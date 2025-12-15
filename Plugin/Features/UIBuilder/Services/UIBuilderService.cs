using System;
using Selva.Config;

namespace Selva.Features.UIBuilder.Services;

public class UIBuilderService : IDisposable
{
  public SchemaManager SchemaManager { get; private set; }
  public ValueApplicator ValueApplicator { get; private set; }
  public ValueCollector ValueCollector { get; private set; }
  public ComponentStateManager StateManager { get; private set; }
  public CommunicationHandler CommunicationHandler { get; private set; }
  public LocalWebServer WebServer { get; private set; }
  public DocumentEventManager EventManager { get; private set; }
  public SchemaCleanupService CleanupService { get; private set; }

  public string SessionId { get; private set; }

  public UIBuilderService(string sessionId)
  {
    SessionId = sessionId;
    InitializeServices();
  }

  private void InitializeServices()
  {
    SchemaManager = new SchemaManager(SessionId);
    ValueApplicator = new ValueApplicator();
    ValueCollector = new ValueCollector();
    StateManager = new ComponentStateManager();
    CommunicationHandler = new CommunicationHandler(SessionId);
    WebServer = new LocalWebServer();
    EventManager = new DocumentEventManager(SchemaManager, ValueCollector, CommunicationHandler);
    CleanupService = new SchemaCleanupService();
  }

  public void Dispose()
  {
    CommunicationHandler?.Dispose();
    WebServer?.Dispose();
    EventManager?.Dispose();
  }
}
