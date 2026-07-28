// ============================================================================
// Test-host stand-ins for the handful of Rhino-bound types that the *linked*
// Selva.GH sources reference at compile time.
//
// Selva.Tests deliberately takes NO ProjectReference on Selva.GH — that project
// pulls in Grasshopper / RhinoCommon / Windows.Forms, which break the net8 test
// host ("Failed to create CoreCLR, HRESULT: 0x80070057"). Instead it links the
// Rhino-free source files it needs (see Selva.Tests.csproj).
//
// Two of those linked files still name a Rhino type in a signature or a
// deferred lambda, so the compiler needs *something* under that name. These
// stubs supply exactly that and nothing more. They are never exercised:
//
//   - HeadlessGuard.IsHeadless is only reached through ComponentStateManager's
//     parameterless ctor; tests use the internal ctor that injects the flag.
//   - Point3d only appears in DisplayItem.Point(...), which no test calls.
//
// If a test ever needs real behaviour from either, that's the signal to move
// the logic under test into a Rhino-free type rather than to grow this file.
// ============================================================================

namespace Selva.GH.Utilities.Guards
{
    public static class HeadlessGuard
    {
        public static bool IsHeadless =>
            throw new System.NotSupportedException(
                "HeadlessGuard is stubbed in Selva.Tests; inject the flag via ComponentStateManager's internal ctor.");
    }
}

namespace Rhino.Geometry
{
    public struct Point3d
    {
        public double X { get; set; }
        public double Y { get; set; }
        public double Z { get; set; }
    }
}
