using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Pipes;
using System.Text;
using System.Text.Json;
using System.Threading;
using Rhino;
using Selva.AppHost;

namespace Selva.RhinoPanel;

/// <summary>
///     This Rhino's end of the pipe to the Selva app that started it. Messages from the app are
///     raised on the UI thread; <see cref="Send" /> may be called from it at any time.
/// </summary>
internal sealed class AppHostLink
{
    private static readonly TimeSpan ConnectTimeout = TimeSpan.FromSeconds(5);
    private static readonly UTF8Encoding Utf8 = new UTF8Encoding(false);

    private readonly NamedPipeClientStream _pipe;
    private readonly StreamWriter _writer;
    private readonly object _writeLock = new object();
    private int _ended;

    private AppHostLink(NamedPipeClientStream pipe)
    {
        _pipe = pipe;
        _writer = new StreamWriter(pipe, Utf8) { AutoFlush = true, NewLine = "\n" };
    }

    public event Action<string, string?>? OpenRequested;

    public event Action? CloseRequested;

    /// <summary>The app asked Rhino to quit, or is gone. Raised once.</summary>
    public event Action? Ended;

    /// <returns>Null with <paramref name="error" /> set when the app isn't listening on that pipe.</returns>
    public static AppHostLink? Connect(string pipeName, out string? error)
    {
        error = null;

        // Asynchronous: a synchronous pipe handle serializes its I/O, so the reader's blocked
        // read would hold up every Send.
        var pipe = new NamedPipeClientStream(".", pipeName, PipeDirection.InOut, PipeOptions.Asynchronous);
        try
        {
            pipe.Connect((int)ConnectTimeout.TotalMilliseconds);
        }
        catch (Exception ex) when (ex is TimeoutException || ex is IOException)
        {
            pipe.Dispose();
            error = "The Selva app isn't listening on that pipe.";
            return null;
        }

        var link = new AppHostLink(pipe);
        new Thread(link.ReadLoop) { IsBackground = true, Name = "Selva app host" }.Start();
        return link;
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
            using var reader = new StreamReader(_pipe, Utf8, false, 4096, true);
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
