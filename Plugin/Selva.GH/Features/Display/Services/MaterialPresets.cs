using System;
using System.Drawing;
using Selva.Slva;

namespace Selva.GH.Features.Display.Services;

/// <summary>
///     The finishes behind the Material Preset component. Metal and concrete base colours are
///     physicallybased.info's measured linear values. Roughness and anisotropy are starting points,
///     to be tuned against photos of the real product, never against another render.
/// </summary>
public static class MaterialPresets
{
    public sealed class Preset
    {
        public string Name;
        public Color Color;
        public double Metalness;
        public double Roughness;
        public double? Anisotropy;
        public UvMapping Mapping;
        public string Finish;
        public double? FinishStrength;
        public double? Transmission;
        public double? Ior;

        /// <summary>The material the Material Preset component outputs.</summary>
        public ThreeMaterial ToMaterial()
        {
            return new ThreeMaterial
            {
                Color = Color,
                Metalness = Metalness,
                Roughness = Roughness,
                Opacity = 1,
                Anisotropy = Anisotropy,
                Finish = Finish,
                FinishStrength = FinishStrength,
                Transmission = Transmission,
                Ior = Ior,
                Mapping = Mapping
            };
        }
    }

    // Index = the Material Preset input's integer value, so append only; 0 is unused.
    public static readonly Preset[] All =
    {
        null,
        new()
        {
            Name = "Stainless steel, brushed", Color = Linear(0.669, 0.639, 0.598), Metalness = 1,
            Roughness = 0.3, Anisotropy = 0.8, Mapping = UvMapping.Part, Finish = "brushed"
        },
        new()
        {
            Name = "Aluminium, mill finish", Color = Linear(0.916, 0.923, 0.924), Metalness = 1,
            Roughness = 0.35, Anisotropy = 0.3, Mapping = UvMapping.Part, Finish = "rolled"
        },
        new()
        {
            Name = "Galvanised steel", Color = Linear(0.808, 0.844, 0.865), Metalness = 1,
            Roughness = 0.4, Mapping = UvMapping.World
        },
        // Weathered zinc is a grey carbonate film over the metal: darker, rougher, half dielectric.
        new()
        {
            Name = "Titanium zinc, weathered", Color = Linear(0.44, 0.46, 0.47), Metalness = 0.6,
            Roughness = 0.55, Anisotropy = 0.2, Mapping = UvMapping.Part, Finish = "rolled"
        },
        new()
        {
            Name = "Copper", Color = Linear(0.932, 0.623, 0.522), Metalness = 1,
            Roughness = 0.3, Anisotropy = 0.3, Mapping = UvMapping.Part, Finish = "rolled"
        },
        // A coil coating is a paint film: metalness 0. Default colour RAL 7016; wire Color for others.
        new()
        {
            Name = "Coil-coated (RAL)", Color = Color.FromArgb(0x38, 0x3E, 0x42), Metalness = 0,
            Roughness = 0.45, Mapping = UvMapping.Surface
        },
        new()
        {
            Name = "Wood", Color = Color.FromArgb(0xA6, 0x7B, 0x50), Metalness = 0,
            Roughness = 0.6, Mapping = UvMapping.Part
        },
        new()
        {
            Name = "Concrete", Color = Linear(0.51, 0.51, 0.51), Metalness = 0,
            Roughness = 0.85, Mapping = UvMapping.World
        },
        new()
        {
            Name = "Glass", Color = Color.White, Metalness = 0, Roughness = 0.05,
            Mapping = UvMapping.Surface, Transmission = 1, Ior = 1.52
        },
        // Appended, not inserted: the index is what a saved Preset input holds.
        new()
        {
            Name = "Brass", Color = Linear(0.913, 0.776, 0.423), Metalness = 1,
            Roughness = 0.35, Anisotropy = 0.3, Mapping = UvMapping.Part, Finish = "rolled"
        },
        new()
        {
            Name = "Titanium", Color = Linear(0.539, 0.497, 0.451), Metalness = 1,
            Roughness = 0.4, Anisotropy = 0.3, Mapping = UvMapping.Part, Finish = "rolled"
        }
    };

    /// <summary>The preset for an input value, or null for "None" and anything out of range.</summary>
    public static Preset Get(int value)
    {
        return value > 0 && value < All.Length ? All[value] : null;
    }

    /// <summary>The preset with this exact <see cref="Preset.Name" />, or null.</summary>
    public static Preset Find(string name)
    {
        for (var i = 1; i < All.Length; i++)
        {
            if (All[i].Name == name)
            {
                return All[i];
            }
        }

        return null;
    }

    // Measured albedos are linear; Color is sRGB.
    private static Color Linear(double r, double g, double b)
    {
        static int Encode(double c)
        {
            var s = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.Pow(c, 1 / 2.4) - 0.055;
            return (int)Math.Round(Math.Max(0, Math.Min(1, s)) * 255);
        }

        return Color.FromArgb(Encode(r), Encode(g), Encode(b));
    }
}
