using System.Runtime.InteropServices;
using GH_IO.Serialization;
using Grasshopper.Kernel.Types;
using Newtonsoft.Json;
using Selva.GH.Features.FileIO.Services;

namespace Selva.GH.Features.FileIO.Goos;

/// <summary>
///     Custom IGH_Goo type for file input data.
///     Wraps FileInputData for Grasshopper data flow.
/// </summary>
[Guid("A3B5C7D9-2E4F-4A8B-9C1D-3F5E7A9B2C4D")]
public class FileInputGoo : GH_Goo<FileInputData>
{
    private static readonly JsonSerializerSettings SecureSettings = new JsonSerializerSettings
    {
        TypeNameHandling = TypeNameHandling.None,
        MaxDepth = 8
    };

    public FileInputGoo()
    {
        Value = new FileInputData();
    }

    public FileInputGoo(FileInputData data)
    {
        Value = data ?? new FileInputData();
    }

    public override string TypeName => "FileInput";

    public override string TypeDescription => "File input data (path, URL, or base64)";

    public override bool IsValid => Value != null && !string.IsNullOrEmpty(Value.File);

    public override IGH_Goo Duplicate()
    {
        return new FileInputGoo(new FileInputData
        {
            File = Value.File,
            Type = Value.Type,
            FileEnding = Value.FileEnding
        });
    }

    public override string ToString()
    {
        if (Value == null)
        {
            return "null";
        }

        return Value.Type switch
        {
            "path" => $"Path: {Value.File}",
            "url" => $"URL: {Value.File}",
            "base64" => $"Base64 ({Value.FileEnding})",
            _ => Value.File ?? "empty"
        };
    }

    public override bool CastFrom(object source)
    {
        if (source == null)
        {
            return false;
        }

        // Cast from string (assume it's a path)
        if (source is string str)
        {
            Value = FileInputData.FromPath(str);
            return true;
        }

        // Cast from GH_String
        if (source is GH_String ghString)
        {
            Value = FileInputData.FromPath(ghString.Value);
            return true;
        }

        // Cast from FileInputData
        if (source is FileInputData fileData)
        {
            Value = fileData;
            return true;
        }

        return false;
    }

    public override bool CastTo<Q>(ref Q target)
    {
        // Cast to string (return the file path/URL/base64)
        if (typeof(Q).IsAssignableFrom(typeof(string)))
        {
            target = (Q)(object)(Value?.File ?? string.Empty);
            return true;
        }

        // Cast to GH_String
        if (typeof(Q).IsAssignableFrom(typeof(GH_String)))
        {
            target = (Q)(object)new GH_String(Value?.File ?? string.Empty);
            return true;
        }

        return false;
    }

    /// <summary>
    ///     Serializes to JSON string for web transmission.
    ///     NOTE: when Type is "base64" this embeds the full file payload in the output string.
    ///     Do not pass base64 Goos to downstream panels or persist them in the .gh file.
    /// </summary>
    public string ToJson()
    {
        return JsonConvert.SerializeObject(Value, SecureSettings);
    }

    /// <summary>
    ///     Deserializes from JSON string.
    /// </summary>
    public static FileInputGoo FromJson(string json)
    {
        try
        {
            var data = JsonConvert.DeserializeObject<FileInputData>(json, SecureSettings);
            return new FileInputGoo(data);
        }
        catch
        {
            return new FileInputGoo();
        }
    }

    /// <summary>
    ///     Serialize to GH_IO for Rhino.Compute compatibility.
    /// </summary>
    public override bool Write(GH_IWriter writer)
    {
        if (Value == null)
        {
            return false;
        }

        writer.SetString("File", Value.File ?? string.Empty);
        writer.SetString("Type", Value.Type ?? string.Empty);
        writer.SetString("FileEnding", Value.FileEnding ?? string.Empty);
        return true;
    }

    /// <summary>
    ///     Deserialize from GH_IO for Rhino.Compute compatibility.
    /// </summary>
    public override bool Read(GH_IReader reader)
    {
        Value = new FileInputData
        {
            File = reader.ItemExists("File") ? reader.GetString("File") : string.Empty,
            Type = reader.ItemExists("Type") ? reader.GetString("Type") : string.Empty,
            FileEnding = reader.ItemExists("FileEnding") ? reader.GetString("FileEnding") : string.Empty
        };
        return true;
    }
}
