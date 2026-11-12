using System.Text;
using Selva.AppFormat;

namespace Selva.Tests;

public class AppFileTests
{
    private static readonly byte[] Definition = Encoding.UTF8.GetBytes("a definition's bytes, as Grasshopper wrote them");
    private static readonly byte[] Icon = { 0x89, 0x50, 0x4E, 0x47, 1, 2, 3 };

    [Fact]
    public void A_plain_file_round_trips_without_a_key()
    {
        var file = AppFileCipher.Pack("Facade studio", Icon, AppDefinitionKind.Binary, Definition, null);

        Assert.True(AppFile.HasMagic(file));
        Assert.Null(AppFile.TryRead(file, out var info));
        Assert.Equal("Facade studio", info.Name);
        Assert.Equal(Icon, info.IconPng);
        Assert.False(info.Encrypted);
        Assert.Equal(AppDefinitionKind.Binary, info.Kind);
        Assert.Null(AppFileCipher.TryUnpack(info, null, out var definition));
        Assert.Equal(Definition, definition);
    }

    [Fact]
    public void A_protected_file_opens_with_its_key_only()
    {
        var file = AppFileCipher.Pack("Facade studio", null, AppDefinitionKind.Xml, Definition, "open sesame");

        Assert.Null(AppFile.TryRead(file, out var info));
        Assert.True(info.Encrypted);
        Assert.Equal(AppDefinitionKind.Xml, info.Kind);
        Assert.Equal(AppFileKey.Hex(AppFileKey.IdOf("open sesame")), info.KeyId);

        Assert.Null(AppFileCipher.TryUnpack(info, "open sesame", out var definition));
        Assert.Equal(Definition, definition);

        Assert.NotNull(AppFileCipher.TryUnpack(info, "open says me", out _));
        Assert.NotNull(AppFileCipher.TryUnpack(info, null, out _));
    }

    [Fact]
    public void The_definition_is_not_readable_in_a_protected_file()
    {
        var file = AppFileCipher.Pack("Facade studio", null, AppDefinitionKind.Binary, Definition, "open sesame");

        Assert.DoesNotContain("as Grasshopper wrote them", Encoding.UTF8.GetString(file));
    }

    [Fact]
    public void Two_files_with_one_key_share_its_id_but_not_their_salt()
    {
        Assert.Null(AppFile.TryRead(
            AppFileCipher.Pack("One", null, AppDefinitionKind.Binary, Definition, "open sesame"), out var one));
        Assert.Null(AppFile.TryRead(
            AppFileCipher.Pack("Two", null, AppDefinitionKind.Binary, Definition, "open sesame"), out var two));

        Assert.Equal(one.KeyId, two.KeyId);
        Assert.NotEqual(one.Salt, two.Salt);
    }

    [Fact]
    public void A_changed_name_fails_a_protected_file()
    {
        var file = AppFileCipher.Pack("Facade studio", null, AppDefinitionKind.Binary, Definition, "open sesame");
        var nameAt = Encoding.UTF8.GetString(file).IndexOf("Facade", StringComparison.Ordinal);
        file[nameAt] = (byte)'f';

        Assert.Null(AppFile.TryRead(file, out var info));
        Assert.NotNull(AppFileCipher.TryUnpack(info, "open sesame", out _));
    }

    [Fact]
    public void An_unknown_chunk_is_skipped()
    {
        var file = AppFileCipher.Pack("Facade studio", null, AppDefinitionKind.Binary, Definition, null).ToList();
        var chunk = Encoding.ASCII.GetBytes("XTRA").Concat(BitConverter.GetBytes(3u)).Concat(new byte[] { 7, 8, 9 });
        file.InsertRange(6, chunk);

        Assert.Null(AppFile.TryRead(file.ToArray(), out var info));
        Assert.Equal("Facade studio", info.Name);
        Assert.Null(AppFileCipher.TryUnpack(info, null, out var definition));
        Assert.Equal(Definition, definition);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(5)]
    [InlineData(9)]
    [InlineData(30)]
    public void A_truncated_file_is_refused(int length)
    {
        var file = AppFileCipher.Pack("Facade studio", null, AppDefinitionKind.Binary, Definition, null);

        Assert.NotNull(AppFile.TryRead(file.Take(length).ToArray(), out _));
    }

    [Fact]
    public void A_newer_format_version_is_refused_with_a_reason()
    {
        var file = AppFileCipher.Pack("Facade studio", null, AppDefinitionKind.Binary, Definition, null);
        file[4] = 2;

        Assert.Contains("newer Selva", AppFile.TryRead(file, out _));
    }

    [Fact]
    public void A_grasshopper_definition_is_not_an_app_file()
    {
        Assert.False(AppFile.HasMagic(Definition));
        Assert.NotNull(AppFile.TryRead(Definition, out _));
    }
}
