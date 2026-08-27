// ============================================================================
// Compile-time stand-ins for Rhino types that the linked (not referenced)
// Selva.GH source files still name in a signature.
//
// Selva.Tests takes no ProjectReference on Selva.GH — that project pulls in
// Grasshopper/RhinoCommon/Windows.Forms, which crash the net8 test host. It
// links the Rhino-free source files it needs instead (see Selva.Tests.csproj).
//
//   - HeadlessGuard.IsHeadless is never exercised: it's reached only through
//     ComponentStateManager's parameterless ctor, and tests use the internal
//     one that injects the flag.
//   - Logger.Log is a no-op sink. MeshBatchAssembler calls it once per batch
//     for cache stats; the real one writes to RhinoApp.
//   - Point3d/Vector3d ARE exercised, by CurveFlatnessTests. The operators
//     must therefore mean what RhinoCommon's mean — note Vector3d * Vector3d
//     is the dot product, not a component-wise multiply.
//
// If a test needs real behavior beyond this, move the logic under test into a
// Rhino-free type rather than growing this file.
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
        public Point3d(double x, double y, double z)
        {
            X = x;
            Y = y;
            Z = z;
        }

        public double X { get; set; }
        public double Y { get; set; }
        public double Z { get; set; }

        public static Vector3d operator -(Point3d a, Point3d b) =>
            new Vector3d(a.X - b.X, a.Y - b.Y, a.Z - b.Z);

        public double DistanceTo(Point3d other) => (this - other).Length;
    }

    public struct Vector3d
    {
        public Vector3d(double x, double y, double z)
        {
            X = x;
            Y = y;
            Z = z;
        }

        public double X { get; set; }
        public double Y { get; set; }
        public double Z { get; set; }

        public double SquareLength => X * X + Y * Y + Z * Z;
        public double Length => System.Math.Sqrt(SquareLength);

        /// <summary>Dot product — matches RhinoCommon's operator, which is not a scalar multiply.</summary>
        public static double operator *(Vector3d a, Vector3d b) => a.X * b.X + a.Y * b.Y + a.Z * b.Z;

        public static Vector3d operator *(Vector3d v, double s) =>
            new Vector3d(v.X * s, v.Y * s, v.Z * s);

        public static Vector3d operator -(Vector3d a, Vector3d b) =>
            new Vector3d(a.X - b.X, a.Y - b.Y, a.Z - b.Z);
    }
}

namespace Selva.GH.Utilities.Helpers
{
    /// <summary>No-op sink; the real Logger writes to RhinoApp, absent from the test host.</summary>
    public static class Logger
    {
        public static void Log(string message) { }
        public static void Error(string message, System.Exception ex = null) { }
    }
}
