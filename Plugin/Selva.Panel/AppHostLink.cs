using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Pipes;
using System.Net.Sockets;
using System.Text;
using System.Text.Json;
using System.Threading;
using Rhino;
using Rhino.Runtime;
using Selva.AppHost;

namespace Selva.RhinoPanel;

/// <summary>
///     This Rhino's end of the channel to the Selva app that started it. Messages from the app are
///     raised on the UI thread; <see cref="Send" /> may be called from it at any time.
/// </summary>
internal sealed class AppHostLink
{
    private static readonly TimeSpan ConnectTimeout = TimeSpan.FromSeconds(5);
    private static readonly UTF8Encoding Utf8 = new UTF8Encoding(false);

    private readonly Stream _channel;
    private readonly StreamWriter _writer;
    private readonly object _writeLock = new object();
    private int _ended;

    private AppHostLink(Stream channel)
    {
        _channel = channel;
        _writer = new StreamWriter(channel, Utf8) { AutoFlush = true, NewLine = "\n" };
    }

    public event Action<string, string?>? OpenRequested;

    public event Action? CloseRequested;

    /// <summary>The app asked Rhino to quit, or is gone. Raised once.</summary>
    public event Action? Ended;

    /// <param name="address"><see cref="AppHostProtocol" /> says what the app passes on each platform.</param>
    /// <returns>Null with <paramref name="error" /> set when the app isn't listening there.</returns>
    public static AppHostLink? Connect(string address, out string? error)
    {
        error = null;
        Stream channel;
        try
        {
            channel = HostUtils.RunningOnWindows ? ConnectPipe(address) : ConnectSocket(address);
        }
        catch (Exception ex) when (ex is TimeoutException || ex is IOException || ex is SocketException ||
                                   ex is ArgumentException)
        {
            error = "The Selva app isn't listening there.";
            return null;
        }

        var link = new AppHostLink(channel);
        new Thread(link.ReadLoop) { IsBackground = true, Name = "Selva app host" }.Start();
        return link;
    }

    private static Stream ConnectPipe(string name)
    {
        // Asynchronous: a synchronous pipe handle serializes its I/O, so the reader's blocked
        // read would hold up every Send.
        var pipe = new NamedPipeClientStream(".", name, PipeDirection.InOut, PipeOptions.Asynchronous);
        try
        {
            pipe.Connect((int)ConnectTimeout.TotalMilliseconds);
            return pipe;
        }
        catch
        {
            pipe.Dispose();
            throw;
        }
    }

    // Not a NamedPipeClientStream: off Windows .NET maps a pipe's name to a socket path of its
    // own, which an app that isn't .NET would have to copy.
    private static Stream ConnectSocket(string path)
    {
        var socket = new Socket(AddressFamily.Unix, SocketType.Stream, ProtocolType.Unspecified);
        try
        {
            socket.Connect(new UnixDomainSocketEndPoint(path));
            return new NetworkStream(socket, true);
        }
        catch
        {
            socket.Dispose();
            throw;
        }
    }

    public void Send(string type, params (string Field, string? Value)[] fields)
    {
        var message = new Dictionary<string, string?> { [AppHostProtocol.TypeField] = type };
        foreach (var (field, value) in fields)
        {
            message[field] = value;
        }

        try
        {
            lock (_writeLock)
            {
                _writer.WriteLine(JsonSerializer.Serialize(message));
            }
        }
        catch (Exception ex) when (ex is IOException || ex is ObjectDisposedException)
        {
            End();
        }
    }

    private void ReadLoop()
    {
        try
        {
            using var reader = new StreamReader(_channel, Utf8, false, 4096, true);
            while (reader.ReadLine() is { } line)
            {
                Dispatch(line);
            }
        }
        catch (Exception ex) when (ex is IOException || ex is ObjectDisposedException)
        {
            // The app closed its end.
        }

        End();
    }

    private void Dispatch(string line)
    {
        Dictionary<string, string?>? message;
        try
        {
            message = JsonSerializer.Deserialize<Dictionary<string, string?>>(line);
        }
        catch (JsonException)
        {
            return;
        }

        if (message == null || !message.TryGetValue(AppHostProtocol.TypeField, out var type))
        {
            return;
        }

        switch (type)
        {
            case AppHostProtocol.Open:
                if (message.TryGetValue(AppHostProtocol.PathField, out var path) && !string.IsNullOrEmpty(path))
                {
                    message.TryGetValue(AppHostProtocol.KeyField, out var key);
                    OnUiThread(() => OpenRequested?.Invoke(path!, string.IsNullOrEmpty(key) ? null : key));
                }

                break;

            case AppHostProtocol.Close:
                OnUiThread(() => CloseRequested?.Invoke());
                break;

            case AppHostProtocol.Quit:
                End();
                break;
        }
    }

    private void End()
    {
        if (Interlocked.Exchange(ref _ended, 1) == 0)
        {
            OnUiThread(() => Ended?.Invoke());
        }
    }

    private static void OnUiThread(Action action)
    {
        RhinoApp.InvokeOnUiThread(action);
    }
}
