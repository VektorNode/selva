using System;
using System.Collections.Generic;
using Selva.GH.Features.UIBuilder.Services.Schema;
using Selva.Schema.Models;

namespace Selva.Tests;

/// <summary>
///     Tests for SchemaHash — the content hash used for save-conflict detection between the UI's
///     last-seen canonical and the server's current canonical. The critical invariant is that the
///     hash is stable across JSON key ordering, so equal schemas always hash equal.
/// </summary>
public class SchemaHashTests
{
    // UISchema.Created/LastModified default to DateTime.UtcNow, so any equality test must pin them
    // to a fixed instant — otherwise two "equivalent" schemas built moments apart hash differently.
    private static readonly DateTime FixedTime = new DateTime(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc);

    private static UISchema Schema(string id = "s", string name = "Schema", params string[] inputNicknames)
    {
        var schema = new UISchema { Id = id, Name = name, Created = FixedTime, LastModified = FixedTime };
        foreach (var nick in inputNicknames)
        {
            schema.Inputs.Add(new SchemaInput { Id = Guid.NewGuid(), Nickname = nick });
        }

        return schema;
    }

    // -------------------------------------------------------------------------
    // Stability
    // -------------------------------------------------------------------------

    [Fact]
    public void Compute_SameSchema_IsDeterministic()
    {
        var schema = Schema(inputNicknames: "Width");

        Assert.Equal(SchemaHash.Compute(schema), SchemaHash.Compute(schema));
    }

    [Fact]
    public void Compute_EquivalentSchemas_ProduceSameHash()
    {
        // Default Created/LastModified are DateTime.UtcNow, so this also proves timestamps
        // are excluded from the hash: two schemas built moments apart still match.
        var a = new UISchema { Id = "s", Name = "Schema" };
        var b = new UISchema { Name = "Schema", Id = "s" };

        Assert.Equal(SchemaHash.Compute(a), SchemaHash.Compute(b));
    }

    [Fact]
    public void Compute_KeyOrderIndependent_ViaInputFieldOrder()
    {
        // Same logical input, properties set in different order — sorting must make these equal.
        var id = Guid.NewGuid();
        var a = new UISchema { Id = "s", Created = FixedTime, LastModified = FixedTime };
        a.Inputs.Add(new SchemaInput { Id = id, Nickname = "W", ParamType = "number" });
        var b = new UISchema { Id = "s", Created = FixedTime, LastModified = FixedTime };
        b.Inputs.Add(new SchemaInput { ParamType = "number", Nickname = "W", Id = id });

        Assert.Equal(SchemaHash.Compute(a), SchemaHash.Compute(b));
    }

    [Fact]
    public void Compute_TimestampsDoNotAffectHash()
    {
        var a = new UISchema { Id = "s", Created = FixedTime, LastModified = FixedTime };
        var b = new UISchema
        {
            Id = "s",
            Created = FixedTime.AddDays(3),
            LastModified = FixedTime.AddMinutes(1)
        };

        Assert.Equal(SchemaHash.Compute(a), SchemaHash.Compute(b));
    }

    // -------------------------------------------------------------------------
    // Sensitivity — meaningful changes must change the hash
    // -------------------------------------------------------------------------

    [Fact]
    public void Compute_DifferentName_ChangesHash()
    {
        var a = Schema(name: "One");
        var b = Schema(name: "Two");

        Assert.NotEqual(SchemaHash.Compute(a), SchemaHash.Compute(b));
    }

    [Fact]
    public void Compute_AddingInput_ChangesHash()
    {
        var a = Schema(inputNicknames: "Width");
        var b = Schema(inputNicknames: "Width");
        b.Inputs.Add(new SchemaInput { Id = Guid.NewGuid(), Nickname = "Height" });

        Assert.NotEqual(SchemaHash.Compute(a), SchemaHash.Compute(b));
    }

    [Fact]
    public void Compute_DifferentInputNickname_ChangesHash()
    {
        var id = Guid.NewGuid();
        var a = Schema();
        a.Inputs.Add(new SchemaInput { Id = id, Nickname = "Width" });
        var b = Schema();
        b.Inputs.Add(new SchemaInput { Id = id, Nickname = "Height" });

        Assert.NotEqual(SchemaHash.Compute(a), SchemaHash.Compute(b));
    }

    // -------------------------------------------------------------------------
    // Null / empty handling
    // -------------------------------------------------------------------------

    [Fact]
    public void Compute_NullSchema_ReturnsEmptyString()
    {
        Assert.Equal(string.Empty, SchemaHash.Compute(null));
    }

    [Fact]
    public void Compute_ReturnsLowercaseHex64Chars()
    {
        var hash = SchemaHash.Compute(Schema());

        Assert.Equal(64, hash.Length); // SHA-256 = 32 bytes = 64 hex chars
        Assert.Matches("^[0-9a-f]+$", hash);
    }
}
