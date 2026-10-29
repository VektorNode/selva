using System;

namespace Selva.Slva;

/// <summary>
///     The web parser's closed-solid test (<c>closed-solid.ts</c>), ported so the writer can send
///     the answer instead of every client recomputing it: on a 2M-vertex sphere the browser spent
///     ~600 ms on it, more than on decoding the mesh. Keep the two in step; the golden cases in
///     <c>ClosedSolidTests</c> mirror <c>closed-solid.test.ts</c>.
///
///     True when the mesh is a closed, consistently wound, outward-facing triangle surface once
///     coincident vertices are welded, so its back faces can never be seen and the material may cull
///     them. Any doubt (an unwelded seam, a non-manifold edge, inward winding) answers false.
/// </summary>
public static class ClosedSolid
{
    public static bool IsClosed(float[] vertices, int[] faces)
    {
        if (vertices == null || faces == null)
        {
            return false;
        }

        var count = faces.Length;
        // A tetrahedron is the smallest closed surface.
        if (count < 12 || count % 3 != 0)
        {
            return false;
        }

        var vertexCount = vertices.Length / 3;

        // --- Weld: map each vertex to the first vertex at (nearly) its position ------------------
        // Rhino meshes each Brep face on its own and stores float32 vertices, so the two copies of a
        // seam point can round one or two float32 steps apart. Snap to a grid two steps wide at the
        // part's largest coordinate: wide enough for that, far below its real features.
        var seen = new bool[vertexCount];
        var firstSeen = new int[Math.Min(count, vertexCount)];
        var uniqueVertices = 0;
        double magnitude = 0;
        for (var i = 0; i < count; i++)
        {
            var v = faces[i];
            if ((uint)v >= (uint)vertexCount)
            {
                return false;
            }

            if (seen[v])
            {
                continue;
            }

            seen[v] = true;
            firstSeen[uniqueVertices++] = v;
            magnitude = Math.Max(magnitude, Math.Max(Math.Abs(vertices[v * 3]),
                Math.Max(Math.Abs(vertices[v * 3 + 1]), Math.Abs(vertices[v * 3 + 2]))));
        }

        if (!(magnitude > 0) || double.IsInfinity(magnitude))
        {
            return false;
        }

        var step = 2 * Math.Pow(2, FloorLog2(magnitude) - 23);
        var inverseCell = 1 / step;

        var weldSize = 16;
        while (weldSize < uniqueVertices * 2)
        {
            weldSize *= 2;
        }

        var weldMask = weldSize - 1;
        // One slot is [canonical, cellX, cellY, cellZ].
        var weldTable = new int[weldSize * 4];
        for (var h = 0; h < weldTable.Length; h += 4)
        {
            weldTable[h] = -1;
        }

        int CellSlot(int x, int y, int z)
        {
            var h = unchecked((x * (int)0x9e3779b1) ^ (y * (int)0x85ebca77) ^ (z * (int)0xc2b2ae3d));
            h = ((h ^ (int)((uint)h >> 15)) & weldMask) * 4;
            while (weldTable[h] != -1 && (weldTable[h + 1] != x || weldTable[h + 2] != y || weldTable[h + 3] != z))
            {
                h = (h + 4) & (weldMask * 4 + 3);
            }

            return h;
        }

        // The cell across the nearer boundary, for a point close enough to it that its near-copy
        // could have rounded into the other cell.
        int Neighbour(double scaled, int cell)
        {
            var offset = scaled - cell;
            return offset > 0.25 ? cell + 1 : offset < -0.25 ? cell - 1 : cell;
        }

        var canonicalOf = new int[vertexCount];
        var vertexOf = new int[uniqueVertices];
        var canonicals = 0;
        for (var u = 0; u < uniqueVertices; u++)
        {
            var v = firstSeen[u];
            var sx = vertices[v * 3] * inverseCell;
            var sy = vertices[v * 3 + 1] * inverseCell;
            var sz = vertices[v * 3 + 2] * inverseCell;
            // Math.Floor(s + 0.5), not Math.Round: JS rounds halves up, .NET to even.
            var x = (int)Math.Floor(sx + 0.5);
            var y = (int)Math.Floor(sy + 0.5);
            var z = (int)Math.Floor(sz + 0.5);
            var nx = Neighbour(sx, x);
            var ny = Neighbour(sy, y);
            var nz = Neighbour(sz, z);

            var canonical = -1;
            var ownSlot = -1;
            for (var combo = 0; combo < 8 && canonical == -1; combo++)
            {
                if (((combo & 1) != 0 && nx == x) || ((combo & 2) != 0 && ny == y) || ((combo & 4) != 0 && nz == z))
                {
                    continue;
                }

                var h = CellSlot((combo & 1) != 0 ? nx : x, (combo & 2) != 0 ? ny : y, (combo & 4) != 0 ? nz : z);
                if (combo == 0)
                {
                    ownSlot = h;
                }

                if (weldTable[h] != -1)
                {
                    canonical = weldTable[h];
                }
            }

            if (canonical == -1)
            {
                // Nothing matched, so the table is as the first probe left it: that slot is still free.
                canonical = canonicals++;
                weldTable[ownSlot] = canonical;
                weldTable[ownSlot + 1] = x;
                weldTable[ownSlot + 2] = y;
                weldTable[ownSlot + 3] = z;
                vertexOf[canonical] = v;
            }

            canonicalOf[v] = canonical;
        }

        var welded = new int[count];
        for (var i = 0; i < count; i++)
        {
            welded[i] = canonicalOf[faces[i]];
        }

        // --- Directed edges: each must occur once, and its reverse once -------------------------
        // That is exactly "every edge joins two triangles that agree on winding", i.e. closed and
        // consistently oriented.
        var outStart = new int[canonicals + 1];
        var triangles = 0;
        for (var i = 0; i < count; i += 3)
        {
            int a = welded[i], b = welded[i + 1], c = welded[i + 2];
            if (a == b || b == c || c == a)
            {
                continue;
            }

            outStart[a + 1]++;
            outStart[b + 1]++;
            outStart[c + 1]++;
            triangles++;
        }

        if (triangles < 4)
        {
            return false;
        }

        for (var k = 0; k < canonicals; k++)
        {
            outStart[k + 1] += outStart[k];
        }

        var outTo = new int[outStart[canonicals]];
        var cursor = new int[canonicals];
        Array.Copy(outStart, cursor, canonicals);
        for (var i = 0; i < count; i += 3)
        {
            int a = welded[i], b = welded[i + 1], c = welded[i + 2];
            if (a == b || b == c || c == a)
            {
                continue;
            }

            outTo[cursor[a]++] = b;
            outTo[cursor[b]++] = c;
            outTo[cursor[c]++] = a;
        }

        for (var a = 0; a < canonicals; a++)
        {
            int first = outStart[a], end = outStart[a + 1];
            for (var k = first; k < end; k++)
            {
                var b = outTo[k];
                for (var j = first; j < k; j++)
                {
                    if (outTo[j] == b)
                    {
                        return false; // second use of one directed edge
                    }
                }

                var reversed = false;
                for (int j = outStart[b], bEnd = outStart[b + 1]; j < bEnd && !reversed; j++)
                {
                    reversed = outTo[j] == a;
                }

                if (!reversed)
                {
                    return false;
                }
            }
        }

        // --- Outward: counter-clockwise winding seen from outside encloses positive volume -------
        var o = vertexOf[welded[0]] * 3;
        double ox = vertices[o], oy = vertices[o + 1], oz = vertices[o + 2];
        double volume = 0;
        for (var i = 0; i < count; i += 3)
        {
            var pa = vertexOf[welded[i]] * 3;
            var pb = vertexOf[welded[i + 1]] * 3;
            var pc = vertexOf[welded[i + 2]] * 3;
            double ax = vertices[pa] - ox, ay = vertices[pa + 1] - oy, az = vertices[pa + 2] - oz;
            double bx = vertices[pb] - ox, by = vertices[pb + 1] - oy, bz = vertices[pb + 2] - oz;
            double cx = vertices[pc] - ox, cy = vertices[pc + 1] - oy, cz = vertices[pc + 2] - oz;
            volume += ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx);
        }

        return volume > 0;
    }

    /// <summary>floor(log2(value)) for a positive finite double, exact (Math.Log rounds near powers of two).</summary>
    private static int FloorLog2(double value)
    {
        var exponent = (int)((BitConverter.DoubleToInt64Bits(value) >> 52) & 0x7FF);
        return exponent == 0 ? (int)Math.Floor(Math.Log(value, 2)) : exponent - 1023;
    }
}
