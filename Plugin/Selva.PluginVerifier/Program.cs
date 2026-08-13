using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Runtime.CompilerServices;

namespace Selva.PluginVerifier;

// ============================================================================
// Post-merge smoke test for the Selva plugin build
// ============================================================================
//
// The Release build ILRepack-merges Newtonsoft.Json + Selva.Schema into
// Selva.gha (and PdfSharpCore/SharpZipLib/SixLabors into Selva.Drawing.dll).
// A merge that goes wrong does not fail the build — it produces an assembly
// whose method references no longer bind, and the first symptom is a
// MissingMethodException inside a user's Rhino (0.17.1 shipped exactly that).
//
// This tool loads every Selva-authored assembly from a plugin output folder on
// the same runtime family Rhino uses and force-JITs every method
// (RuntimeHelpers.PrepareMethod). JIT compilation performs the same member
// binding Rhino performs when the plugin loads, so a corrupted reference fails
// here, in the build, instead of in the field.
//
// Usage: Selva.PluginVerifier <pluginOutputDir>
// Exit codes: 0 = clean, 1 = verification failures, 2 = bad invocation.

internal static class Program
{
    // Assemblies the plugin is supposed to carry or bind against. A load
    // failure for one of these is a real defect. Anything else (Eto, Rhino.UI,
    // native-backed Rhino runtime bits) is unavailable headlessly by design and
    // only downgrades the affected method to a skip.
    private static readonly string[] ClosureAssemblyPrefixes =
    {
        "Selva", "Grasshopper", "GH_IO", "RhinoCommon",
        "Newtonsoft.Json", "System.Drawing.Common", "System.Windows.Forms",
        "SixLabors", "PdfSharpCore", "ICSharpCode.SharpZipLib",
    };

    // References that must NOT survive in the merged assemblies — their
    // presence means an ILRepack pass silently didn't happen or didn't
    // internalize what it was supposed to.
    private static readonly Dictionary<string, string[]> ForbiddenReferences = new()
    {
        ["Selva"] = new[] { "Newtonsoft.Json", "Selva.Schema" },
        ["Selva.Drawing"] = new[]
        {
            "PdfSharpCore", "ICSharpCode.SharpZipLib",
            "SixLabors.ImageSharp", "SixLabors.Fonts",
        },
    };

    private static readonly List<string> Failures = new();
    private static readonly List<string> Skips = new();

    public static int Main(string[] args)
    {
        if (args.Length != 1 || !Directory.Exists(args[0]))
        {
            Console.Error.WriteLine("Usage: Selva.PluginVerifier <pluginOutputDir>");
            return 2;
        }

        var pluginDir = Path.GetFullPath(args[0]);
        Console.WriteLine($"Verifying plugin output: {pluginDir}");
        Console.WriteLine($"Runtime: {System.Runtime.InteropServices.RuntimeInformation.FrameworkDescription}");

        AppDomain.CurrentDomain.AssemblyResolve += (_, e) => ResolveFrom(pluginDir, e.Name);

        var targets = Directory.GetFiles(pluginDir, "*.gha")
            .Concat(Directory.GetFiles(pluginDir, "Selva*.dll"))
            .ToArray();
        if (targets.Length == 0)
        {
            Console.Error.WriteLine("No Selva assemblies found in the given directory.");
            return 2;
        }

        int methodsJitted = 0, typesSeen = 0;
        foreach (var path in targets)
        {
            Assembly asm;
            try
            {
                asm = Assembly.LoadFrom(path);
            }
            catch (Exception ex)
            {
                Failures.Add($"{Path.GetFileName(path)}: failed to load — {ex.GetType().Name}: {ex.Message}");
                continue;
            }

            CheckForbiddenReferences(asm);
            JitSweep(asm, ref methodsJitted, ref typesSeen);
        }

        Console.WriteLine();
        Console.WriteLine($"JIT-compiled {methodsJitted} methods across {typesSeen} types.");
        if (Skips.Count > 0)
        {
            Console.WriteLine($"Skipped {Skips.Count} methods (environment-only dependencies):");
            foreach (var s in Skips.Take(10)) Console.WriteLine($"  ~ {s}");
            if (Skips.Count > 10) Console.WriteLine($"  ~ … and {Skips.Count - 10} more");
        }

        if (Failures.Count > 0)
        {
            Console.Error.WriteLine();
            Console.Error.WriteLine($"✗ {Failures.Count} verification failure(s):");
            foreach (var f in Failures) Console.Error.WriteLine($"  ✗ {f}");
            return 1;
        }

        Console.WriteLine("✓ All member references bind.");
        return 0;
    }

    private static Assembly? ResolveFrom(string pluginDir, string fullName)
    {
        var simpleName = new AssemblyName(fullName).Name;
        if (simpleName is null) return null;

        foreach (var dir in new[] { pluginDir, AppContext.BaseDirectory })
        {
            var candidate = Path.Combine(dir, simpleName + ".dll");
            if (File.Exists(candidate)) return Assembly.LoadFrom(candidate);
        }
        return null;
    }

    private static void CheckForbiddenReferences(Assembly asm)
    {
        var simpleName = asm.GetName().Name ?? "";
        if (!ForbiddenReferences.TryGetValue(simpleName, out var forbidden)) return;

        foreach (var reference in asm.GetReferencedAssemblies())
        {
            if (forbidden.Contains(reference.Name))
                Failures.Add(
                    $"{simpleName}: still references {reference.Name} — " +
                    "the ILRepack merge did not run or did not internalize it.");
        }
    }

    private static void JitSweep(Assembly asm, ref int methodsJitted, ref int typesSeen)
    {
        Type?[] types;
        try
        {
            types = asm.GetTypes();
        }
        catch (ReflectionTypeLoadException ex)
        {
            types = ex.Types;
            foreach (var le in ex.LoaderExceptions.Where(e => e is not null))
                Classify(asm.GetName().Name + " (type load)", le!);
        }

        const BindingFlags all = BindingFlags.DeclaredOnly | BindingFlags.Public |
                                 BindingFlags.NonPublic | BindingFlags.Instance | BindingFlags.Static;

        foreach (var type in types)
        {
            if (type is null || type.ContainsGenericParameters) continue;
            typesSeen++;

            IEnumerable<MethodBase> methods;
            try
            {
                methods = type.GetMethods(all).Cast<MethodBase>()
                    .Concat(type.GetConstructors(all));
                if (type.TypeInitializer is { } cctor) methods = methods.Append(cctor);
            }
            catch (Exception ex)
            {
                Classify($"{type.FullName} (member enumeration)", ex);
                continue;
            }

            foreach (var method in methods)
            {
                if (method.IsAbstract || method.ContainsGenericParameters) continue;
                try
                {
                    RuntimeHelpers.PrepareMethod(method.MethodHandle);
                    methodsJitted++;
                }
                catch (Exception ex)
                {
                    Classify($"{type.FullName}.{method.Name}", ex);
                }
            }
        }
    }

    private static void Classify(string site, Exception ex)
    {
        // JIT wraps some binding failures; report the innermost cause.
        while (ex.InnerException is { } inner && ex is TargetInvocationException or TypeInitializationException)
            ex = inner;

        switch (ex)
        {
            // Native libraries for other OSes (libfontconfig, CoreFoundation, …)
            // inside merged deps; OS-guarded at runtime, never loadable here. A
            // managed merge defect cannot produce this. Must precede the
            // TypeLoadException case — DllNotFoundException derives from it.
            case DllNotFoundException:
                Skips.Add($"{site} (native: {ex.Message.Split('\'').Skip(1).FirstOrDefault()})");
                break;

            case MissingMemberException or BadImageFormatException or InvalidProgramException:
                Failures.Add($"{site} → {ex.GetType().Name}: {ex.Message}");
                break;

            case TypeLoadException or FileNotFoundException or FileLoadException:
                var assemblyName = ExtractAssemblyName(ex);
                if (assemblyName is null || ClosureAssemblyPrefixes.Any(p => assemblyName.StartsWith(p, StringComparison.OrdinalIgnoreCase)))
                    Failures.Add($"{site} → {ex.GetType().Name}: {ex.Message}");
                else
                    Skips.Add($"{site} (needs {assemblyName})");
                break;

            default:
                Skips.Add($"{site} ({ex.GetType().Name}: {ex.Message})");
                break;
        }
    }

    private static string? ExtractAssemblyName(Exception ex) => ex switch
    {
        FileNotFoundException { FileName: { } f } => new AssemblyName(f).Name,
        FileLoadException { FileName: { } f } => new AssemblyName(f).Name,
        TypeLoadException tle => TypeLoadAssembly(tle),
        _ => null,
    };

    private static string? TypeLoadAssembly(TypeLoadException ex)
    {
        // TypeLoadException.Message ends with "...from assembly 'Name, Version=...'."
        var marker = "from assembly '";
        var i = ex.Message.IndexOf(marker, StringComparison.Ordinal);
        if (i < 0) return null;
        var rest = ex.Message.Substring(i + marker.Length);
        var end = rest.IndexOf('\'');
        return end < 0 ? null : new AssemblyName(rest.Substring(0, end)).Name;
    }
}
