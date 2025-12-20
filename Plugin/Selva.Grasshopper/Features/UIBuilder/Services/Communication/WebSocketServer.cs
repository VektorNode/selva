using System;
using System.Collections.Generic;
using System.Net;
using System.Net.WebSockets;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Selva.Grasshopper.Config;
using Selva.Grasshopper.Utilities.Helpers;

namespace Selva.Grasshopper.Features.UIBuilder.Services.Communication;

/// <summary>
///   Simple WebSocket server for real-time communication with the web UI
///   Only used for local interactive mode
/// </summary>
public class WebSocketServer : IDisposable
{
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

	public WebSocketServer(int port = AppConfig.WebSocket.DefaultPort)
	{
		Port = port;
	}

	public bool IsRunning { get; private set; }

	public int Port { get; private set; }

	public void Dispose()
	{
		Stop();
		_heartbeatTimer?.Dispose();
		_cancellationTokenSource?.Dispose();
		GC.SuppressFinalize(this);
	}

	~WebSocketServer()
	{
		Dispose();
	}

	public event EventHandler<string> OnMessageReceived;
	public event EventHandler<WebSocket> OnClientConnected;

	/// <summary>
	///   Start the WebSocket server with dynamic port allocation
	/// </summary>
	public Task StartAsync()
	{
		if (IsRunning) return Task.CompletedTask;

		_cancellationTokenSource = new CancellationTokenSource();

		// If port is 0, find an available port dynamically
		if (Port == 0) Port = FindAvailablePort();

		_httpListener = new HttpListener();
		_httpListener.Prefixes.Add($"http://localhost:{Port}/");

		try
		{
			_httpListener.Start();
			IsRunning = true;
			Logger.Log($"WebSocket server started on port {Port}");

			// Start accepting connections in background
			_ = Task.Run(async () => await AcceptConnectionsAsync(_cancellationTokenSource.Token));

			// Start heartbeat to detect and clean up dead connections
			StartHeartbeat();

			return Task.CompletedTask;
		}
		catch (HttpListenerException ex)
		{
			// If the specified port failed, try to find an available port
			Logger.Warn($"Port {Port} failed to bind, attempting to find alternative port: {ex.Message}");
			Port = FindAvailablePort();

			// Retry with discovered port
			_httpListener = new HttpListener();
			_httpListener.Prefixes.Add($"http://localhost:{Port}/");

			try
			{
				_httpListener.Start();
				IsRunning = true;
				Logger.Log($"WebSocket server started on fallback port {Port}");

				_ = Task.Run(async () => await AcceptConnectionsAsync(_cancellationTokenSource.Token));
				StartHeartbeat();

				return Task.CompletedTask;
			}
			catch (Exception retryEx)
			{
				throw new Exception($"Failed to start WebSocket server on port {Port}: {retryEx.Message}", retryEx);
			}
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
				try
				{
					// Attempt graceful close with timeout
					var closeTask = client?.CloseAsync(WebSocketCloseStatus.NormalClosure, "Server shutting down",
						CancellationToken.None);
					if (closeTask != null) closeTask.Wait(AppConfig.WebSocket.ClientCloseTimeoutMs);

					client?.Dispose();
				}
				catch (Exception ex)
				{
					Logger.Warn($"Error disposing WebSocket client: {ex.Message}");
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
					Logger.Warn("Broadcast timeout for client - removing from pool");
					clientsToRemove.Add(client);
				}
				catch (Exception ex)
				{
					Logger.Warn($"Broadcast failed for client: {ex.Message}");
					clientsToRemove.Add(client);
				}
			else
				clientsToRemove.Add(client);

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
					catch (Exception ex)
					{
						Logger.Warn($"Error disposing WebSocket client: {ex.Message}");
					}
				}
			}
	}

	private async Task AcceptConnectionsAsync(CancellationToken cancellationToken)
	{
		while (!cancellationToken.IsCancellationRequested && IsRunning)
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
			catch (HttpListenerException ex)
			{
				Logger.Warn($"WebSocket listener stopped: {ex.Message}");
				break;
			}
			catch (Exception ex)
			{
				Logger.Error($"Error accepting WebSocket connection: {ex.Message}");
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
		catch (Exception ex)
		{
			Logger.Error($"WebSocket request processing error: {ex.Message}");
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
				catch (Exception ex)
				{
					Logger.Warn($"Error closing WebSocket: {ex.Message}");
				}
			}
		}
	}

	private async Task ReceiveMessagesAsync(WebSocket webSocket, CancellationToken cancellationToken)
	{
		var buffer = new byte[BUFFER_SIZE];
		var messageBuffer = new List<byte>();

		while (webSocket.State == WebSocketState.Open && !cancellationToken.IsCancellationRequested)
			try
			{
				messageBuffer.Clear();
				WebSocketReceiveResult result;

				do
				{
					result = await webSocket.ReceiveAsync(new ArraySegment<byte>(buffer), cancellationToken);

					if (result.MessageType == WebSocketMessageType.Close)
					{
						// Use CloseOutputAsync instead of CloseAsync to allow receiving close frame
						if (webSocket.State == WebSocketState.Open)
						{
							try
							{
								await webSocket.CloseOutputAsync(WebSocketCloseStatus.NormalClosure, "Closing",
									CancellationToken.None);
							}
							catch
							{
								// Already closed, just exit
							}
						}
						return;
					}

					for (var i = 0; i < result.Count; i++) messageBuffer.Add(buffer[i]);

					if (messageBuffer.Count > MAX_MESSAGE_SIZE)
					{
						if (webSocket.State == WebSocketState.Open)
						{
							try
							{
								await webSocket.CloseOutputAsync(WebSocketCloseStatus.MessageTooBig,
									$"Message exceeds maximum size of {MAX_MESSAGE_SIZE} bytes",
									CancellationToken.None);
							}
							catch
							{
								// Already closed, just exit
							}
						}
						return;
					}
				} while (!result.EndOfMessage);

				if (result.MessageType == WebSocketMessageType.Text)
				{
					var message = Encoding.UTF8.GetString(messageBuffer.ToArray());
					OnMessageReceived?.Invoke(this, message);
				}
			}
			catch (WebSocketException ex)
			{
				Logger.Warn($"WebSocket exception: {ex.Message}");
				break;
			}
			catch (OperationCanceledException)
			{
				Logger.Log("WebSocket operation canceled");
				break;
			}
	}

	/// <summary>
	///   Find an available port for WebSocket server
	///   Tries default port first, then random ports in configured range
	/// </summary>
	private int FindAvailablePort()
	{
		// First, try the default port (fast path for single instance)
		try
		{
			using (var listener = new HttpListener())
			{
				listener.Prefixes.Add($"http://localhost:{AppConfig.WebSocket.DefaultPort}/");
				listener.Start();
				listener.Stop();
				Logger.Log($"WebSocket port {AppConfig.WebSocket.DefaultPort} available (default)");
				return AppConfig.WebSocket.DefaultPort;
			}
		}
		catch (Exception)
		{
			Logger.Log(
				$"Default WebSocket port {AppConfig.WebSocket.DefaultPort} not available, searching for alternative...");
		}

		// Default port unavailable, try random ports in range
		var random = new Random();
		for (var i = 0; i < AppConfig.WebSocket.PortDiscoveryAttempts; i++)
		{
			var port = random.Next(AppConfig.WebSocket.PortRangeMin, AppConfig.WebSocket.PortRangeMax);

			try
			{
				using (var listener = new HttpListener())
				{
					listener.Prefixes.Add($"http://localhost:{port}/");
					listener.Start();
					listener.Stop();
					Logger.Log($"WebSocket port {port} available (fallback)");
					return port;
				}
			}
			catch (Exception)
			{
				// Port not available, try next
			}
		}

		// All attempts failed, return random port in extended range as last resort
		var fallbackPort = random.Next(AppConfig.WebSocket.PortRangeMax, AppConfig.WebSocket.PortRangeMax + 1000);
		Logger.Warn($"Could not find available port in preferred range, using fallback port {fallbackPort}");
		return fallbackPort;
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
					catch (Exception ex)
					{
						Logger.Warn($"Heartbeat failed for client: {ex.Message}");
						clientsToRemove.Add(client);
					}
				else
					clientsToRemove.Add(client);

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
						catch (Exception ex)
						{
							Logger.Warn($"Error disposing WebSocket during heartbeat cleanup: {ex.Message}");
						}
					}
				}
		}, null, HEARTBEAT_INTERVAL, HEARTBEAT_INTERVAL);
	}
}
