using GH_IO.Serialization;
using Grasshopper.Kernel.Types;
using Newtonsoft.Json;
using Selva.GH.Features.FileIO.Services;

namespace Selva.GH.Features.FileIO.Goos;

public class FileDataGoo : IGH_Goo
{
    public FileDataGoo()
    {
    }

    public FileDataGoo(FileData value)
    {
        Value = value;
    }

    public FileData Value { get; set; }

    public bool IsValid => Value != null && !string.IsNullOrEmpty(Value.FileName);

    public string IsValidWhyNot => Value == null
        ? "FileData value is null"
        : string.IsNullOrEmpty(Value.FileName)
            ? "FileData has no file name"
            : string.Empty;

    public string TypeName => "FileData";

    public string TypeDescription => "File data for export";

    public IGH_Goo Duplicate()
    {
        if (Value == null)
        {
            return new FileDataGoo();
        }

        // Deep copy via JSON serialization
        var json = JsonConvert.SerializeObject(Value);
        var copy = JsonConvert.DeserializeObject<FileData>(json);
        return new FileDataGoo(copy);
    }

    public IGH_GooProxy EmitProxy()
    {
        return null;
    }

    public bool CastFrom(object source)
    {
        if (source is FileData td)
        {
            Value = td;
            return true;
        }

        return false;
    }

    public bool CastTo<T>(out T target)
    {
        if (typeof(T).IsAssignableFrom(typeof(FileData)))
        {
            target = (T)(object)Value;
            return true;
        }

        target = default;
        return false;
    }

    public object ScriptVariable()
    {
        return Value;
    }

    public bool Write(GH_IWriter writer)
    {
        if (Value == null)
        {
            return false;
        }

        var json = JsonConvert.SerializeObject(Value);
        writer.SetString("FileDataJson", json);
        return true;
    }

    public bool Read(GH_IReader reader)
    {
        if (!reader.ItemExists("FileDataJson"))
        {
            return false;
        }

        var json = reader.GetString("FileDataJson");
        Value = JsonConvert.DeserializeObject<FileData>(json);
        return true;
    }

    public override string ToString()
    {
        if (Value == null)
        {
            return "Null FileData";
        }

        if (string.IsNullOrEmpty(Value.FileName))
        {
            return "FileData (no filename)";
        }

        return $"FileData: {Value.FileName}";
    }
}
