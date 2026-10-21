using Selva.GH.Features.SelvaUpload.Services;

namespace Selva.Tests;

public class ApiKeyFormatTests
{
    // Made by Selva's own codec: `selva_` + 30 base62 + base62 CRC32 of those 30.
    private const string Valid = "selva_Abc123XYZabc123XYZabc123XYZabc1GCgGf";

    [Fact]
    public void Key_FromSelvasCodec_IsWellFormed()
    {
        Assert.True(ApiKeyFormat.IsWellFormed(Valid));
    }

    [Theory]
    [InlineData("selva_Abc123XYZabc123XYZabc123XYZabc1GCgGg")] // checksum off by one
    [InlineData("selva_Abc123XYZabc123XYZabc123XYZab1GCgGf")] // truncated
    [InlineData("selva_Abc123XYZabc123XYZabc123XYZabc1GCgGf ")]
    [InlineData("Selva_Abc123XYZabc123XYZabc123XYZabc1GCgGf")]
    [InlineData("sk_Abc123XYZabc123XYZabc123XYZabc1GCgGf")]
    [InlineData("selva_Abc123XYZabc123XYZabc123XYZ-bc1GCgGf")]
    [InlineData("")]
    [InlineData(null)]
    public void Anything_Else_IsNot(string? key)
    {
        Assert.False(ApiKeyFormat.IsWellFormed(key));
    }
}
