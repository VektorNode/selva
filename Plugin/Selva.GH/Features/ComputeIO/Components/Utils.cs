using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Linq;
using Rhino.Input;
using Rhino.Input.Custom;

namespace Selva.GH.Features.ComputeIO.Components;

public static class Utils
{
    public static Bitmap ContextualiseIcon(Bitmap bitmap)
    {
        var bitmap1 = (Bitmap)bitmap.Clone();
        using (var graphics = Graphics.FromImage(bitmap1))
        {
            graphics.SmoothingMode = SmoothingMode.None;
            graphics.PixelOffsetMode = PixelOffsetMode.None;
            graphics.FillRectangle(Brushes.Purple, 0, 16 /*0x10*/, 24, 7);
        }

        var white = Color.White;
        for (var x = 1; x < 9; ++x)
        {
            bitmap1.SetPixel(x, 17, white);
            bitmap1.SetPixel(x, 19, white);
            bitmap1.SetPixel(x, 21, white);
        }

        for (var x = 11; x < 22; x += 2)
        {
            bitmap1.SetPixel(x, 21, white);
        }

        bitmap1.SetPixel(11, 17, white);
        bitmap1.SetPixel(13, 17, white);
        bitmap1.SetPixel(12, 18, white);
        bitmap1.SetPixel(12, 19, white);
        bitmap1.SetPixel(12, 20, white);
        return bitmap1;
    }

    /// <summary>Open-file dialog for a Get param's prompt. Null when cancelled.</summary>
    public static List<string> PickFiles(string title, IEnumerable<string> extensions, bool multiple)
    {
        var dialog = new Rhino.UI.OpenFileDialog
        {
            Title = title,
            Filter = "Supported files|" + string.Join(";", extensions.Select(ext => "*" + ext)) + "|All files|*.*",
            MultiSelect = multiple
        };

        if (!dialog.ShowOpenDialog())
        {
            return null;
        }

        return multiple ? dialog.FileNames.ToList() : new List<string> { dialog.FileName };
    }

    /// <summary>
    ///     Asks on the Rhino command line for up to <paramref name="atMost" /> of
    ///     <paramref name="names" />; Enter ends the list after the first pick. Null when cancelled.
    /// </summary>
    public static List<string> PickOptions(string prompt, IReadOnlyList<string> names, int atMost)
    {
        var picked = new List<string>();
        while (picked.Count < atMost)
        {
            var getter = new GetOption();
            getter.SetCommandPrompt(prompt);
            getter.AcceptNothing(picked.Count > 0);

            // Option names must be command-line safe; a name that cannot become one is not offered.
            var nameByOption = new Dictionary<int, string>();
            foreach (var name in names)
            {
                var optionName = RhinoGet.StringToCommandOptionName(name);
                if (!string.IsNullOrEmpty(optionName))
                {
                    nameByOption[getter.AddOption(optionName)] = name;
                }
            }

            if (nameByOption.Count == 0)
            {
                return null;
            }

            var result = getter.Get();
            if (result == GetResult.Nothing)
            {
                break;
            }

            if (result != GetResult.Option || !nameByOption.TryGetValue(getter.OptionIndex(), out var chosen))
            {
                return null;
            }

            picked.Add(chosen);
        }

        return picked;
    }
}
