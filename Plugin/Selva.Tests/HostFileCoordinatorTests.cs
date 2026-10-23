using System;
using System.Collections.Generic;
using System.IO;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using Selva.GH.Features.UIBuilder.Services;

namespace Selva.Tests;

public sealed class HostFileCoordinatorTests : IDisposable
{
    private const string Session = "session-1";

    private readonly string _dir = Path.Combine(Path.GetTempPath(), "selva-hostfiles-" + Guid.NewGuid().ToString("N"));
    private readonly FakeDialogs _dialogs = new();
    private readonly RecordingReply _reply = new();

    public HostFileCoordinatorTests()
    {
        Directory.CreateDirectory(_dir);
    }

    public void Dispose()
    {
        Directory.Delete(_dir, true);
    }

    private HostFileCoordinator Coordinator(long maxFileBytes = 1024, Action<Action>? onUiThread = null)
    {
        return new HostFileCoordinator(_dialogs, onUiThread ?? (a => a()), Session, maxFileBytes);
    }

    // -------------------------------------------------------------------------
    // Save
    // -------------------------------------------------------------------------

    [Fact]
    public async Task Save_WritesTheBytesWhereTheUserChose()
    {
        var path = Path.Combine(_dir, "chosen.zip");
        _dialogs.SavePath = path;

        Coordinator().HandleSave("7", "facade.zip", new ArraySegment<byte>(new byte[] { 0, 1, 2, 3 }, 1, 2), _reply);

        var reply = await _reply.Next();
        Assert.Equal("hostSaveFileResult", (string?)reply["type"]);
        Assert.Equal("7", (string?)reply["requestId"]);
        Assert.Equal("saved", (string?)reply["outcome"]);
        Assert.Equal("facade.zip", _dialogs.SuggestedName);
        Assert.Equal(new byte[] { 1, 2 }, File.ReadAllBytes(path));
    }

    [Fact]
    public async Task Save_TheUserCancels_RepliesCancelled()
    {
        Coordinator().HandleSave("7", "facade.zip", new ArraySegment<byte>(new byte[1]), _reply);

        Assert.Equal("cancelled", (string?)(await _reply.Next())["outcome"]);
    }

    [Fact]
    public async Task Save_OverTheLimit_FailsWithoutADialog()
    {
        Coordinator(maxFileBytes: 4).HandleSave("7", "big.zip", new ArraySegment<byte>(new byte[5]), _reply);

        var reply = await _reply.Next();
        Assert.Equal("failed", (string?)reply["outcome"]);
        Assert.False(string.IsNullOrEmpty((string?)reply["error"]));
        Assert.Null(_dialogs.SuggestedName);
    }

    [Fact]
    public async Task Save_ThatCannotBeWritten_Fails()
    {
        _dialogs.SavePath = Path.Combine(_dir, "missing-folder", "chosen.zip");

        Coordinator().HandleSave("7", "facade.zip", new ArraySegment<byte>(new byte[1]), _reply);

        var reply = await _reply.Next();
        Assert.Equal("failed", (string?)reply["outcome"]);
        Assert.StartsWith("Could not save the file", (string?)reply["error"]);
    }

    // A second dialog would open inside the first one's modal loop.
    [Fact]
    public async Task Request_WhileADialogIsOpen_FailsBusy_AndTheNextOneWorks()
    {
        var queued = new List<Action>();
        var coordinator = Coordinator(onUiThread: queued.Add);

        coordinator.HandleSave("7", "a.zip", new ArraySegment<byte>(new byte[1]), _reply);
        coordinator.HandlePick("8", new[] { ".slvp" }, _reply);

        var busy = await _reply.Next();
        Assert.Equal("hostPickFileResult", (string?)busy["type"]);
        Assert.Equal("failed", (string?)busy["outcome"]);

        queued[0]();
        Assert.Equal("cancelled", (string?)(await _reply.Next())["outcome"]);

        coordinator.HandlePick("9", new[] { ".slvp" }, _reply);
        queued[1]();
        Assert.Equal("cancelled", (string?)(await _reply.Next())["outcome"]);
    }

    // -------------------------------------------------------------------------
    // Pick
    // -------------------------------------------------------------------------

    [Fact]
    public async Task Pick_SendsTheFileInOneFrame()
    {
        var path = Path.Combine(_dir, "preset.slvp");
        File.WriteAllBytes(path, new byte[] { 4, 5, 6 });
        _dialogs.OpenPath = path;

        Coordinator().HandlePick("8", new[] { ".slvp", ".sps" }, _reply);

        var (header, body) = await _reply.NextFile();
        Assert.Equal("hostPickedFile", (string?)header["type"]);
        Assert.Equal(Session, (string?)header["sessionId"]);
        Assert.Equal("8", (string?)header["requestId"]);
        Assert.Equal("preset.slvp", (string?)header["name"]);
        Assert.Equal(new byte[] { 4, 5, 6 }, body);
        Assert.Equal(new[] { "slvp", "sps" }, _dialogs.Extensions);
    }

    [Fact]
    public async Task Pick_OverTheLimit_Fails()
    {
        var path = Path.Combine(_dir, "big.3dm");
        File.WriteAllBytes(path, new byte[5]);
        _dialogs.OpenPath = path;

        Coordinator(maxFileBytes: 4).HandlePick("8", Array.Empty<string>(), _reply);

        Assert.Equal("failed", (string?)(await _reply.Next())["outcome"]);
    }

    [Fact]
    public async Task Pick_TheUserCancels_RepliesCancelled()
    {
        Coordinator().HandlePick("8", Array.Empty<string>(), _reply);

        Assert.Equal("cancelled", (string?)(await _reply.Next())["outcome"]);
    }

    [Theory]
    [InlineData(new[] { ".slvp", ".SPS" }, new[] { "slvp", "sps" })]
    [InlineData(new[] { " .3dm " }, new[] { "3dm" })]
    [InlineData(new[] { "image/*" }, new[] { "png", "jpg", "jpeg", "gif", "webp", "bmp", "tif", "tiff", "svg" })]
    [InlineData(new[] { "*" }, new string[0])]
    [InlineData(new[] { ".gh", "application/pdf" }, new string[0])]
    [InlineData(new string[0], new string[0])]
    public void AcceptExtensions_MapsTheInputAcceptList(string[] accept, string[] expected)
    {
        Assert.Equal(expected, HostFileCoordinator.AcceptExtensions(accept));
    }

    // -------------------------------------------------------------------------
    // Fakes
    // -------------------------------------------------------------------------

    private sealed class FakeDialogs : IHostFileDialogs
    {
        public string? SavePath;
        public string? OpenPath;
        public string? SuggestedName;
        public IReadOnlyList<string>? Extensions;

        public string? AskSavePath(string suggestedName)
        {
            SuggestedName = suggestedName;
            return SavePath;
        }

        public string? AskOpenPath(IReadOnlyList<string> extensions)
        {
            Extensions = extensions;
            return OpenPath;
        }
    }

    private sealed class RecordingReply : IHostFileReply
    {
        private readonly Queue<TaskCompletionSource<(JObject, byte[]?)>> _pending = new();
        private readonly Queue<(JObject, byte[]?)> _sent = new();

        public Task SendAsync(object envelope)
        {
            Record(JObject.FromObject(envelope), null);
            return Task.CompletedTask;
        }

        public Task SendFileAsync(object header, byte[] body)
        {
            Record(JObject.FromObject(header), body);
            return Task.CompletedTask;
        }

        public async Task<JObject> Next()
        {
            var (envelope, body) = await NextAny();
            Assert.Null(body);
            return envelope;
        }

        public async Task<(JObject, byte[])> NextFile()
        {
            var (header, body) = await NextAny();
            Assert.NotNull(body);
            return (header, body!);
        }

        private Task<(JObject, byte[]?)> NextAny()
        {
            lock (_sent)
            {
                if (_sent.Count > 0)
                {
                    return Task.FromResult(_sent.Dequeue());
                }

                var tcs = new TaskCompletionSource<(JObject, byte[]?)>(TaskCreationOptions.RunContinuationsAsynchronously);
                _pending.Enqueue(tcs);
                return tcs.Task.WaitAsync(TimeSpan.FromSeconds(5));
            }
        }

        private void Record(JObject envelope, byte[]? body)
        {
            lock (_sent)
            {
                if (_pending.Count > 0)
                {
                    _pending.Dequeue().SetResult((envelope, body));
                }
                else
                {
                    _sent.Enqueue((envelope, body));
                }
            }
        }
    }
}
