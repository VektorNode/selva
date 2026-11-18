// Screenshots Rhino's main window with its floating windows drawn on top, where they sit.
// PrintWindow draws a window that is covered or off screen, so nothing else on the desktop can
// end up in the picture, which a desktop grab cannot promise.
//
// Run in Rhino:  _-ScriptEditor _Run "<repo>\scripts\marketing\rhino\window.cs"
// Where to write comes from %TEMP%\selva-shot.txt: one line, the full path without ".png".
// A path ending in "@editor" shoots the Grasshopper editor alone.

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;

// Windows 11 reports a frame 7 px wider than it draws on the left, right and bottom.
const int Shadow = 7;

// `name` is rooted, so Path.Combine(folder, name) below returns it as it is.
var name = File.ReadAllText(Path.Combine(Path.GetTempPath(), "selva-shot.txt")).Trim();
var folder = Path.GetDirectoryName(name);
Directory.CreateDirectory(folder);

// Prints nothing: the script's output lands in the command history, and so in the next shot.
Rhino.RhinoApp.ClearCommandHistoryWindow();
Rhino.RhinoApp.Wait();

if (name.EndsWith("@editor"))
{
	name = name.Substring(0, name.Length - "@editor".Length);
	var editor = Grasshopper.Instances.DocumentEditor.Handle;
	GetWindowRect(editor, out var bounds);
	using var alone = Print(editor, bounds);
	using var trimmed = alone.Clone(
		new Rectangle(Shadow, 0, alone.Width - Shadow * 2, alone.Height - Shadow), alone.PixelFormat);
	trimmed.Save(Path.Combine(folder, name + ".png"), ImageFormat.Png);
	return;
}

var main = Rhino.RhinoApp.MainWindowHandle();
GetWindowRect(main, out var frame);
uint pid = (uint)Process.GetCurrentProcess().Id;

// EnumWindows walks front to back.
var floating = new List<IntPtr>();
EnumWindows((window, _) =>
{
	GetWindowThreadProcessId(window, out var owner);
	if (owner != pid || window == main || !IsWindowVisible(window) || IsIconic(window)) return true;
	GetWindowRect(window, out var r);
	if (r.Right - r.Left > 200 && r.Bottom - r.Top > 200) floating.Add(window);
	return true;
}, IntPtr.Zero);

Bitmap Print(IntPtr window, RECT r)
{
	var bitmap = new Bitmap(r.Right - r.Left, r.Bottom - r.Top);
	using var g = Graphics.FromImage(bitmap);
	var dc = g.GetHdc();
	// 2 = PW_RENDERFULLCONTENT: without it the viewports and the WebView come out black.
	PrintWindow(window, dc, 2);
	g.ReleaseHdc(dc);
	return bitmap;
}

using var shot = new Bitmap(frame.Right - frame.Left - Shadow * 2, frame.Bottom - frame.Top - Shadow);
using (var g = Graphics.FromImage(shot))
{
	using (var image = Print(main, frame)) g.DrawImage(image, -Shadow, 0);
	for (var i = floating.Count - 1; i >= 0; i--)
	{
		GetWindowRect(floating[i], out var r);
		using var image = Print(floating[i], r);
		g.DrawImage(image, r.Left - frame.Left - Shadow, r.Top - frame.Top);
	}
}
shot.Save(Path.Combine(folder, name + ".png"), ImageFormat.Png);
Rhino.RhinoApp.ClearCommandHistoryWindow();

[StructLayout(LayoutKind.Sequential)]
struct RECT { public int Left, Top, Right, Bottom; }
delegate bool EnumProc(IntPtr window, IntPtr data);
[DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr window, out RECT rect);
[DllImport("user32.dll")] static extern bool PrintWindow(IntPtr window, IntPtr dc, uint flags);
[DllImport("user32.dll")] static extern bool EnumWindows(EnumProc callback, IntPtr data);
[DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint pid);
[DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
[DllImport("user32.dll")] static extern bool IsIconic(IntPtr window);
