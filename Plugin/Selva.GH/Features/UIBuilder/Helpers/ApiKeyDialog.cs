using Eto.Drawing;
using Eto.Forms;

namespace Selva.GH.Features.UIBuilder.Helpers;

/// <summary>
///     Where a pasted Selva key is typed: in Rhino, so the key never passes through the web UI.
///     Returns the key, or null when cancelled.
/// </summary>
internal sealed class ApiKeyDialog : Dialog<string>
{
    public ApiKeyDialog(string host)
    {
        Title = "Use a Selva API key";
        Resizable = false;
        Padding = new Padding(16);

        var keyBox = new PasswordBox { Width = 380 };
        var useKey = new Button { Text = "Use key" };
        var cancel = new Button { Text = "Cancel" };
        useKey.Click += (_, _) => Close(keyBox.Text);
        cancel.Click += (_, _) => Close(null);
        DefaultButton = useKey;
        AbortButton = cancel;

        Content = new StackLayout
        {
            Spacing = 10,
            Items =
            {
                new Label { Text = $"Paste an API key for {host}." },
                new Label
                {
                    Text = "Create one in Selva under Team → API tokens. An upload-only key is the safest. " +
                           "The plugin keeps it in your system's credential store, never in the file.",
                    Wrap = WrapMode.Word,
                    Width = 380
                },
                keyBox,
                new StackLayoutItem(new StackLayout
                {
                    Orientation = Orientation.Horizontal,
                    Spacing = 8,
                    Items = { cancel, useKey }
                }, HorizontalAlignment.Right)
            }
        };
    }
}
