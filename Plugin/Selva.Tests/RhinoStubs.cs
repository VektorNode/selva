// ============================================================================
// Compile-time stand-ins for Rhino types that the linked (not referenced)
// Selva.GH source files still name in a signature.
//
// Selva.Tests takes no ProjectReference on Selva.GH — that project pulls in
// Grasshopper/RhinoCommon/Windows.Forms, which crash the net8 test host. It
// links the Rhino-free source files it needs instead (see Selva.Tests.csproj).
// These two stubs exist only so the linked files still compile; neither is
// ever exercised:
//
//   - HeadlessGuard.IsHeadless is reached only through ComponentStateManager's
//     parameterless ctor; tests use the internal ctor that injects the flag.
//   - Point3d only appears in DisplayItem.Point(...), which no test calls.
//
// If a test ever needs real behavior from either, move the logic under test
// into a Rhino-free type rather than growing this file.
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
