using System;
using System.Collections.Generic;
using System.Net;
using System.Net.WebSockets;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Selva.Config;

namespace Selva.Features.UIBuilder.Services;

/// <summary>
///   Simple WebSocket server for real-time communication with the web UI
///   Only used for local interactive mode
/// </summary>
public class WebSocketServer : IDisposable
{
  // Security: Maximum message size (10MB) to prevent memory exhaustion attacks
  private const int MAX_MESSAGE_SIZE = AppConfig.WebSocket.MaxMessageSizeBytes;
  private const int BUFFER_SIZE = AppConfig.WebSocket.BufferSizeBytes;
  private const int MAX_CLIENTS = AppConfig.WebSocket.MaxConcurrentClients;
  private const int HEARTBEAT_INTERVAL = AppConfig.WebSocket.HeartbeatIntervalMs;
  private const int BROADCAST_TIMEOUT = AppConfig.WebSocket.BroadcastTimeoutMs;

  private readonly object _clientsLock = new();
  private readonly List<WebSocket> _connectedClients = new();
  private CancellationTokenSource _cancellationTokenSource;
  private Timer _heartbeatTimer;
  private HttpListener _httpListener;

  public WebSocketServer(int port = 8765)
  {
    Port = port;
  }

  public bool IsRunning { get; private set; }

  public int Port { get; }

  public void Dispose()
  {
    Stop();
    _heartbeatTimer?.Dispose();
    _cancellationTokenSource?.Dispose();
  }

  public event EventHandler<string> OnMessageReceived;
  public event EventHandler<WebSocket> OnClientConnected;

  /// <summary>
  ///   Start the WebSocket server
  /// </summary>
  public Task StartAsync()
  {
    if (IsRunning) return Task.CompletedTask;

    _cancellationTokenSource = new CancellationTokenSource();
    _httpListener = new HttpListener();
    _httpListener.Prefixes.Add($"http://localhost:{Port}/");

    try
    {
      _httpListener.Start();
      IsRunning = true;

      // Start accepting connections in background
      _ = Task.Run(async () => await AcceptConnectionsAsync(_cancellationTokenSource.Token));

      // Start heartbeat to detect and clean up dead connections
      StartHeartbeat();

      return Task.CompletedTask;
    }
    catch (Exception ex)
    {
      throw new Exception($"Failed to start WebSocket server: {ex.Message}", ex);
    }
  }

  /// <summary>
  ///   Stop the WebSocket server
  /// </summary>
  public void Stop()
  {
    if (!IsRunning) return;

    // Stop heartbeat
    _heartbeatTimer?.Dispose();
    _heartbeatTimer = null;

    _cancellationTokenSource?.Cancel();

    lock (_clientsLock)
    {
      foreach (var client in _connectedClients)
      {
        try
        {
          client?.CloseAsync(WebSocketCloseStatus.NormalClosure, "Server shutting down",
            CancellationToken.None).Wait(1000);
          client?.Dispose();
        }
        catch
        {
        }
      }

      _connectedClients.Clear();
    }

    _httpListener?.Stop();
    _httpListener?.Close();
    IsRunning = false;
  }

  /// <summary>
  ///   Send a message to all connected clients
  /// </summary>
  public async Task BroadcastAsync(string message)
  {
    if (!IsRunning) return;

    var buffer = Encoding.UTF8.GetBytes(message);
    var segment = new ArraySegment<byte>(buffer);

    List<WebSocket> clientsCopy;
    lock (_clientsLock)
    {
      clientsCopy = new List<WebSocket>(_connectedClients);
    }

    var clientsToRemove = new List<WebSocket>();

    foreach (var client in clientsCopy)
    {
      if (client.State == WebSocketState.Open)
        try
        {
          // Add timeout to prevent slow clients from blocking broadcast
          using (var cts = new CancellationTokenSource(BROADCAST_TIMEOUT))
          {
            await client.SendAsync(segment, WebSocketMessageType.Text, true, cts.Token);
          }
        }
        catch (OperationCanceledException)
        {
          clientsToRemove.Add(client);
        }
        catch
        {
          clientsToRemove.Add(client);
        }
      else
        clientsToRemove.Add(client);
    }

    // Remove dead clients
    if (clientsToRemove.Count > 0)
      lock (_clientsLock)
      {
        foreach (var client in clientsToRemove)
        {
          _connectedClients.Remove(client);
          try
          {
            client.Dispose();
          }
          catch
          {
          }
        }
      }
  }

  private async Task AcceptConnectionsAsync(CancellationToken cancellationToken)
  {
    while (!cancellationToken.IsCancellationRequested && IsRunning)
    {
      try
      {
        var context = await _httpListener.GetContextAsync();

        if (context.Request.IsWebSocketRequest)
        {
          ProcessWebSocketRequest(context, cancellationToken);
        }
        else
        {
          context.Response.StatusCode = 400;
          context.Response.Close();
        }
      }
      catch (HttpListenerException)
      {
        break;
      }
      catch (Exception)
      {
      }
    }
  }

  private async void ProcessWebSocketRequest(HttpListenerContext context, CancellationToken cancellationToken)
  {
    WebSocket webSocket = null;

    try
    {
      var webSocketContext = await context.AcceptWebSocketAsync(null);
      webSocket = webSocketContext.WebSocket;

      var shouldReject = false;
      lock (_clientsLock)
      {
        if (_connectedClients.Count >= MAX_CLIENTS)
          shouldReject = true;
        else
          _connectedClients.Add(webSocket);
      }

      if (shouldReject)
      {
        await webSocket.CloseAsync(
          WebSocketCloseStatus.PolicyViolation,
          "Maximum client connections reached",
          CancellationToken.None);
        webSocket.Dispose();
        return;
      }

      OnClientConnected?.Invoke(this, webSocket);

      await ReceiveMessagesAsync(webSocket, cancellationToken);
    }
    catch (Exception)
    {
    }
    finally
    {
      if (webSocket != null)
      {
        lock (_clientsLock)
        {
          _connectedClients.Remove(webSocket);
        }

        try
        {
          if (webSocket.State == WebSocketState.Open)
            await webSocket.CloseAsync(WebSocketCloseStatus.NormalClosure, "Connection closed",
              CancellationToken.None);

          webSocket.Dispose();
        }
        catch
        {
        }
      }
    }
  }

  private async Task ReceiveMessagesAsync(WebSocket webSocket, CancellationToken cancellationToken)
  {
    var buffer = new byte[BUFFER_SIZE];
    var messageBuffer = new List<byte>();

    while (webSocket.State == WebSocketState.Open && !cancellationToken.IsCancellationRequested)
    {
      try
      {
        messageBuffer.Clear();
        WebSocketReceiveResult result;

        do
        {
          result = await webSocket.ReceiveAsync(new ArraySegment<byte>(buffer), cancellationToken);

          if (result.MessageType == WebSocketMessageType.Close)
          {
            await webSocket.CloseAsync(WebSocketCloseStatus.NormalClosure, "Closing",
              CancellationToken.None);
            return;
          }

          for (var i = 0; i < result.Count; i++)
          {
            messageBuffer.Add(buffer[i]);
          }

          if (messageBuffer.Count > MAX_MESSAGE_SIZE)
          {
            await webSocket.CloseAsync(WebSocketCloseStatus.MessageTooBig,
              $"Message exceeds maximum size of {MAX_MESSAGE_SIZE} bytes",
              CancellationToken.None);
            return;
          }
        } while (!result.EndOfMessage);

        if (result.MessageType == WebSocketMessageType.Text)
        {
          var message = Encoding.UTF8.GetString(messageBuffer.ToArray());
          OnMessageReceived?.Invoke(this, message);
        }
      }
      catch (WebSocketException)
      {
        break;
      }
      catch (OperationCanceledException)
      {
        break;
      }
    }
  }

  /// <summary>
  ///   Start heartbeat timer to detect and clean up dead connections
  /// </summary>
  private void StartHeartbeat()
  {
    _heartbeatTimer = new Timer(async _ =>
    {
      if (!IsRunning) return;

      List<WebSocket> clients;
      lock (_clientsLock)
      {
        clients = new List<WebSocket>(_connectedClients);
      }

      var clientsToRemove = new List<WebSocket>();

      foreach (var client in clients)
      {
        if (client.State == WebSocketState.Open)
          try
          {
            // Send ping by sending empty text message
            // Note: Proper WebSocket ping frames would require lower-level control
            var pingBuffer = Encoding.UTF8.GetBytes("");
            using (var cts = new CancellationTokenSource(5000))
            {
              await client.SendAsync(
                new ArraySegment<byte>(pingBuffer),
                WebSocketMessageType.Text,
                true,
                cts.Token
              );
            }
          }
          catch
          {
            clientsToRemove.Add(client);
          }
        else
          clientsToRemove.Add(client);
      }

      if (clientsToRemove.Count > 0)
        lock (_clientsLock)
        {
          foreach (var client in clientsToRemove)
          {
            _connectedClients.Remove(client);
            try
            {
              client.Dispose();
            }
            catch
            {
            }
          }
        }
    }, null, HEARTBEAT_INTERVAL, HEARTBEAT_INTERVAL);
  }
}
