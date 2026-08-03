using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using Grasshopper.Kernel;
using Grasshopper.Kernel.Types;
using Selva.GH.Features.Display.Goos;
using Selva.GH.Features.Display.Params;
using Selva.GH.Features.Display.Services;
using Selva.GH.Properties;
using Selva.GH.Utilities.Guards;

namespace Selva.GH.Features.Display.Components;

public class GH_ThreeMaterial : GH_Component
{
    // Past this size, a data-URI texture (the headless fallback) re-ships enough base64 per solve
    // to hurt — warn so the user knows to host the image instead.
    private const int DataUriWarnBytes = 2 * 1024 * 1024;

    public GH_ThreeMaterial()
        : base("Three Material", "TM",
            "Creates a ThreeMaterial object for web display",
            "Selva", "Display")
    {
    }

    public override Guid ComponentGuid => new Guid("B7665E1A-C4CC-49D6-8EDB-4AAEF045D9A8");

    protected override Bitmap Icon => Resources.ThreeMaterial;

    protected override void RegisterInputParams(GH_InputParamManager pManager)
    {
        pManager.AddColourParameter("Color", "C", "Material color", GH_ParamAccess.item, Color.White);
        pManager.AddNumberParameter("Metalness", "M", "Metalness (0.0 - 1.0)", GH_ParamAccess.item, 0.0);
        pManager.AddNumberParameter("Roughness", "R", "Roughness (0.0 - 1.0)", GH_ParamAccess.item, 0.5);
        pManager.AddNumberParameter("Opacity", "O", "Opacity (0.0 - 1.0)", GH_ParamAccess.item, 1.0);
        pManager.AddBooleanParameter("Transparent", "T", "Is material transparent?", GH_ParamAccess.item, false);
        pManager.AddGenericParameter("Texture", "TX",
            "Optional texture for the material's color map: a bitmap, an image URL, or an image file path. "
            + "Meshes displayed with a textured material carry their texture coordinates to the web viewer.",
            GH_ParamAccess.item);

        pManager[5].Optional = true;
    }

    protected override void RegisterOutputParams(GH_OutputParamManager pManager)
    {
        pManager.AddParameter(new Param_ThreeMaterial());
    }

    protected override void SolveInstance(IGH_DataAccess DA)
    {
        var color = Color.White;
        var metalness = 0.0;
        var roughness = 0.5;
        var opacity = 1.0;
        var transparent = false;
        IGH_Goo textureGoo = null;

        DA.GetData(0, ref color);
        DA.GetData(1, ref metalness);
        DA.GetData(2, ref roughness);
        DA.GetData(3, ref opacity);
        DA.GetData(4, ref transparent);
        DA.GetData(5, ref textureGoo);

        var material = new ThreeMaterial
        {
            Color = color,
            Metalness = metalness,
            Roughness = roughness,
            Opacity = opacity,
            Transparent = transparent,
            Map = ResolveTexture(textureGoo)
        };

        DA.SetData(0, new ThreeMaterialGoo(material));
    }

    // http(s)/data URLs pass through untouched. Bitmaps and local files are content-hashed and
    // served from the plugin's asset endpoint, so re-solves never re-ship image bytes — see
    // PublishTexture for the headless fallback.
    private string ResolveTexture(IGH_Goo goo)
    {
        if (goo == null)
        {
            return null;
        }

        var value = goo.ScriptVariable();
        switch (value)
        {
            case Bitmap bitmap:
            {
                using (var ms = new MemoryStream())
                {
                    bitmap.Save(ms, ImageFormat.Png);
                    return PublishTexture(ms.ToArray(), "image/png");
                }
            }
            case string s when !string.IsNullOrWhiteSpace(s):
            {
                var trimmed = s.Trim();
                if (trimmed.StartsWith("http://", StringComparison.OrdinalIgnoreCase)
                    || trimmed.StartsWith("https://", StringComparison.OrdinalIgnoreCase)
                    || trimmed.StartsWith("data:", StringComparison.OrdinalIgnoreCase))
                {
                    return trimmed;
                }

                if (!File.Exists(trimmed))
                {
                    AddRuntimeMessage(GH_RuntimeMessageLevel.Warning,
                        $"Texture file not found: {trimmed}");
                    return null;
                }

                return PublishTexture(File.ReadAllBytes(trimmed), MimeFromExtension(trimmed));
            }
            default:
                AddRuntimeMessage(GH_RuntimeMessageLevel.Warning,
                    "Texture input must be a bitmap, an image URL, or an image file path");
                return null;
        }
    }

    private string PublishTexture(byte[] bytes, string mime)
    {
        if (HeadlessGuard.IsHeadless)
        {
            if (bytes.Length > DataUriWarnBytes)
            {
                AddRuntimeMessage(GH_RuntimeMessageLevel.Warning,
                    $"Texture is {bytes.Length / (1024 * 1024)} MB and is embedded inline in headless mode — "
                    + "host it at a URL to avoid re-sending it on every solve");
            }

            return $"data:{mime};base64,{Convert.ToBase64String(bytes)}";
        }

        return TextureAssetStore.Register(bytes, mime);
    }

    private static string MimeFromExtension(string path)
    {
        switch (Path.GetExtension(path).ToLowerInvariant())
        {
            case ".png": return "image/png";
            case ".jpg":
            case ".jpeg": return "image/jpeg";
            case ".webp": return "image/webp";
            case ".gif": return "image/gif";
            case ".svg": return "image/svg+xml";
            case ".bmp": return "image/bmp";
            default: return "application/octet-stream";
        }
    }
}
