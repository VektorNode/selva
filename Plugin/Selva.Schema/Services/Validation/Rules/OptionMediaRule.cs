using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;
using Selva.Schema.Models;

namespace Selva.Schema.Services.Validation.Rules;

/// <summary>
///     Checks the assets table and the optionMedia entries that point into it. Assets travel inside
///     the .gh and render in every viewer, so an image must be an inline raster data URI: anything
///     else could be a URL that makes each viewer's browser call wherever the file points.
/// </summary>
public class OptionMediaRule : IValidationRule
{
    // The builder keeps thumbnails well under this; past it the .gh and its backups grow noticeably.
    private const int MaxAssetChars = 64 * 1024;

    private static readonly Regex RasterDataUri =
        new Regex(@"^data:image/(webp|jpeg|png);base64,[A-Za-z0-9+/=]+$", RegexOptions.Compiled);

    public IEnumerable<ValidationIssue> Validate(UISchema schema)
    {
        var assets = schema.Assets ?? new Dictionary<string, OptionAsset>();

        foreach (var entry in assets)
        {
            foreach (var issue in ValidateAsset(entry.Key, entry.Value))
            {
                yield return issue;
            }
        }

        foreach (var (item, media) in OptionMediaOf(schema.Layout))
        {
            foreach (var option in media)
            {
                foreach (var assetId in new[] { option.Value?.Icon, option.Value?.Image })
                {
                    if (assetId != null && !assets.ContainsKey(assetId))
                    {
                        yield return ValidationIssue.Error(
                            item.ParamId.ToString(),
                            $"Option '{option.Key}' of {item.DisplayName ?? item.ParamId.ToString()} uses asset '{assetId}', which the schema doesn't contain",
                            "Every optionMedia icon and image must be a key of the schema's assets");
                    }
                }
            }
        }
    }

    private static IEnumerable<ValidationIssue> ValidateAsset(string id, OptionAsset asset)
    {
        var hasPath = !string.IsNullOrEmpty(asset?.D);
        var hasImage = !string.IsNullOrEmpty(asset?.Img);

        if (hasPath == hasImage)
        {
            yield return ValidationIssue.Error(
                null,
                $"Asset '{id}' must hold exactly one of a path (d) or an image (img)");
            yield break;
        }

        if (hasImage && !RasterDataUri.IsMatch(asset.Img))
        {
            yield return ValidationIssue.Error(
                null,
                $"Asset '{id}' is not a WebP, JPEG or PNG data URI",
                "Images are shown to every viewer, so only inline raster data URIs are accepted");
        }

        var size = hasPath ? asset.D.Length : asset.Img.Length;
        if (size > MaxAssetChars)
        {
            yield return ValidationIssue.Warning(
                null,
                $"Asset '{id}' is {size / 1024} KB, which every copy of the .gh carries",
                "Re-add the image in the builder to shrink it");
        }
    }

    private static IEnumerable<(LayoutItemBase item, Dictionary<string, OptionMedia> media)> OptionMediaOf(
        LayoutConfigBase layout)
    {
        var groups = layout switch
        {
            TabbedLayoutConfig tabbed => tabbed.Tabs?.SelectMany(t => t.Groups ?? new List<GroupConfig>()),
            FlatLayoutConfig flat => flat.Groups,
            _ => null
        } ?? Enumerable.Empty<GroupConfig>();

        foreach (var item in groups.SelectMany(g => g.Items ?? new List<LayoutItemBase>()))
        {
            var media = item switch
            {
                InputDropdownLayoutItem dropdown => dropdown.Config?.OptionMedia,
                InputDynamicValueListLayoutItem dynamic => dynamic.Config?.OptionMedia,
                _ => null
            };
            if (media != null)
            {
                yield return (item, media);
            }
        }
    }
}
