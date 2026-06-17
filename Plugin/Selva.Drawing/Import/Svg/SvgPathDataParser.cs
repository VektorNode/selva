using System;
using System.Collections.Generic;
using System.Globalization;
using Selva.Drawing.Model.Geometry;

namespace Selva.Drawing.Import.Svg;

// ============================================================================
// Parses the SVG <path d="..."> mini-language into the typed Path model.
// ============================================================================
//
// Supports the full command set: M/m L/l H/h V/v C/c S/s Q/q T/t A/a Z/z, in
// both absolute (upper) and relative (lower) forms, with implicit repeated
// command arguments (e.g. "M 0 0 1 1 2 2" = one moveto then two linetos). The
// model's segment kinds map 1:1 to SVG; quadratics elevate to cubics and the
// S/T smooth shorthands reflect the previous control point.
internal static class SvgPathDataParser
{
    public static Path Parse(string d)
    {
        if (string.IsNullOrWhiteSpace(d)) return Path.Empty;

        var tokens = new PathTokenizer(d);
        var builder = new Path.Builder();

        var current = Point2D.Zero;       // current point
        var subpathStart = Point2D.Zero;  // for Z
        var hasCurrent = false;

        // Last control point of the previous C/S (cubic) or Q/T (quadratic), in absolute
        // coords — used to reflect for S/T smooth commands. Tracked per-family.
        Point2D? lastCubicControl = null;
        Point2D? lastQuadControl = null;

        char command = '\0';

        while (tokens.TryPeekCommand(out var c))
        {
            // A command letter may be present, or arguments may repeat the previous command.
            if (char.IsLetter(c))
            {
                command = c;
                tokens.ConsumeCommand();
            }
            else if (command == '\0')
            {
                // Numbers before any command — malformed; stop.
                break;
            }

            var abs = char.IsUpper(command);
            switch (char.ToUpperInvariant(command))
            {
                case 'M':
                {
                    var p = ReadPoint(tokens, current, abs);
                    builder.MoveTo(p);
                    current = p;
                    subpathStart = p;
                    hasCurrent = true;
                    lastCubicControl = lastQuadControl = null;
                    // Subsequent implicit pairs after a moveto are linetos (per SVG spec).
                    command = abs ? 'L' : 'l';
                    break;
                }
                case 'L':
                {
                    var p = ReadPoint(tokens, current, abs);
                    builder.LineTo(p);
                    current = p;
                    lastCubicControl = lastQuadControl = null;
                    break;
                }
                case 'H':
                {
                    var x = tokens.ReadNumber();
                    var p = new Point2D(abs ? x : current.X + x, current.Y);
                    builder.LineTo(p);
                    current = p;
                    lastCubicControl = lastQuadControl = null;
                    break;
                }
                case 'V':
                {
                    var y = tokens.ReadNumber();
                    var p = new Point2D(current.X, abs ? y : current.Y + y);
                    builder.LineTo(p);
                    current = p;
                    lastCubicControl = lastQuadControl = null;
                    break;
                }
                case 'C':
                {
                    var c1 = ReadPoint(tokens, current, abs);
                    var c2 = ReadPoint(tokens, current, abs);
                    var to = ReadPoint(tokens, current, abs);
                    builder.CubicTo(c1, c2, to);
                    current = to;
                    lastCubicControl = c2;
                    lastQuadControl = null;
                    break;
                }
                case 'S':
                {
                    // Smooth cubic: first control is the reflection of the previous one.
                    var c1 = Reflect(lastCubicControl, current);
                    var c2 = ReadPoint(tokens, current, abs);
                    var to = ReadPoint(tokens, current, abs);
                    builder.CubicTo(c1, c2, to);
                    current = to;
                    lastCubicControl = c2;
                    lastQuadControl = null;
                    break;
                }
                case 'Q':
                {
                    var ctrl = ReadPoint(tokens, current, abs);
                    var to = ReadPoint(tokens, current, abs);
                    builder.QuadraticTo(current, ctrl, to);
                    current = to;
                    lastQuadControl = ctrl;
                    lastCubicControl = null;
                    break;
                }
                case 'T':
                {
                    // Smooth quadratic: control is the reflection of the previous one.
                    var ctrl = Reflect(lastQuadControl, current);
                    var to = ReadPoint(tokens, current, abs);
                    builder.QuadraticTo(current, ctrl, to);
                    current = to;
                    lastQuadControl = ctrl;
                    lastCubicControl = null;
                    break;
                }
                case 'A':
                {
                    var rx = tokens.ReadNumber();
                    var ry = tokens.ReadNumber();
                    var xRot = tokens.ReadNumber();
                    var largeArc = tokens.ReadFlag();
                    var sweep = tokens.ReadFlag();
                    var to = ReadPoint(tokens, current, abs);
                    builder.ArcTo(to, rx, ry, xRot, largeArc, sweep);
                    current = to;
                    lastCubicControl = lastQuadControl = null;
                    break;
                }
                case 'Z':
                {
                    builder.Close();
                    current = subpathStart;
                    lastCubicControl = lastQuadControl = null;
                    break;
                }
                default:
                    // Unknown command — bail rather than loop forever.
                    return builder.Build();
            }

            _ = hasCurrent;
        }

        return builder.Build();
    }

    private static Point2D ReadPoint(PathTokenizer t, Point2D current, bool absolute)
    {
        var x = t.ReadNumber();
        var y = t.ReadNumber();
        return absolute ? new Point2D(x, y) : new Point2D(current.X + x, current.Y + y);
    }

    private static Point2D Reflect(Point2D? lastControl, Point2D current)
    {
        // If there's no previous control point, the reflection is the current point itself.
        if (!lastControl.HasValue) return current;
        var lc = lastControl.Value;
        return new Point2D(2 * current.X - lc.X, 2 * current.Y - lc.Y);
    }

    // Tokenizes path data: whitespace and commas are separators; command letters and numbers
    // (including signs, decimals, and exponents) are tokens. Flags (0/1) in arc commands are
    // single digits, possibly not separated from following numbers ("...0 1 25,25" or
    // "...0125,25") — ReadFlag handles that.
    private sealed class PathTokenizer
    {
        private readonly string _s;
        private int _i;

        public PathTokenizer(string s) { _s = s; _i = 0; }

        private void SkipSeparators()
        {
            while (_i < _s.Length && (char.IsWhiteSpace(_s[_i]) || _s[_i] == ',')) _i++;
        }

        public bool TryPeekCommand(out char c)
        {
            SkipSeparators();
            if (_i >= _s.Length) { c = '\0'; return false; }
            c = _s[_i];
            return true;
        }

        public void ConsumeCommand() => _i++;

        public double ReadNumber()
        {
            SkipSeparators();
            var start = _i;

            if (_i < _s.Length && (_s[_i] == '+' || _s[_i] == '-')) _i++;

            var sawDigit = false;
            while (_i < _s.Length && char.IsDigit(_s[_i])) { _i++; sawDigit = true; }
            if (_i < _s.Length && _s[_i] == '.')
            {
                _i++;
                while (_i < _s.Length && char.IsDigit(_s[_i])) { _i++; sawDigit = true; }
            }
            // Exponent.
            if (sawDigit && _i < _s.Length && (_s[_i] == 'e' || _s[_i] == 'E'))
            {
                _i++;
                if (_i < _s.Length && (_s[_i] == '+' || _s[_i] == '-')) _i++;
                while (_i < _s.Length && char.IsDigit(_s[_i])) _i++;
            }

            if (!sawDigit) throw new FormatException($"Expected number in path data at index {start}");

            var span = _s.Substring(start, _i - start);
            return double.Parse(span, NumberStyles.Float, CultureInfo.InvariantCulture);
        }

        // Arc flags are a single '0' or '1' and may be packed against neighbours.
        public bool ReadFlag()
        {
            SkipSeparators();
            if (_i >= _s.Length) throw new FormatException("Expected arc flag");
            var ch = _s[_i];
            if (ch != '0' && ch != '1') throw new FormatException($"Invalid arc flag '{ch}'");
            _i++;
            return ch == '1';
        }
    }
}
