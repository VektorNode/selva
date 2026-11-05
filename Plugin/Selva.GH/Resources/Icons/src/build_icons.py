"""Generates the Selva component icons: <Name>.svg + <Name>.png (24px) in the parent folder.
The material spheres (ThreeMaterial, ParamThreeMaterial) and the tab Icon are hand-made PNGs.

Run: py build_icons.py [Name ...]      (needs: pip install resvg-py pillow)

Family spec, sampled from the existing set:
- Icons sit on the dark rounded TILE (2..22), glyph area 4..20. The tile is the casing, so
  glyphs need no outline and read on both the light component body and Rhino's dark ribbon.
- Drawing (PDF/SVG) icons have no tile: glyph area 2..22 plus a 1px TILE casing (cased()).
- Parameters use a dark hexagon instead of the tile, as Grasshopper's own parameter icons do.
- PALE is the subject, MID the secondary or acted-on element. FOREST is
  ~1.3:1 on the tile: use it only for deliberately dim detail, never for anything that must read.
- Overlapping shapes are separated by a 1px TILE gap (gap()), not by an outline.
- Badge slot 12..20 x 12..20, bottom-right, cased by a 1px tile gap over the main glyph.
- Fills on whole pixels; 2px lines centre on whole pixels.
- No drop shadow: the tile or casing already separates the icon.
"""
import io, math, os, sys
import resvg_py
from PIL import Image, ImageFilter

TILE, PALE, MID, FOREST = "#28231d", "#cadc7a", "#749843", "#2f4329"

OUT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def rect(x, y, w, h, fill=PALE, rx=1):
    return f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{rx}" fill="{fill}"/>'


def gap(x, y, w, h, rx=1):
    """Tile-coloured knockout one pixel larger than the shape drawn over it."""
    return rect(x - 1, y - 1, w + 2, h + 2, TILE, rx + 1)


def path(d, fill=PALE):
    return f'<path d="{d}" fill="{fill}"/>'


def stroke(d, color=PALE, w=2, cap="butt"):
    return f'<path d="{d}" fill="none" stroke="{color}" stroke-width="{w}" stroke-linecap="{cap}" stroke-linejoin="miter"/>'


def circle(cx, cy, r, fill=PALE):
    return f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="{fill}"/>'


def tile(*content):
    return rect(2, 2, 20, 20, TILE, 3) + "".join(content)


# ============================================================================
# Family objects
# ============================================================================

def page(x0, y0, x1, y1, fill=PALE, fold=4):
    """File page with a folded top-right corner: the notch is the file silhouette."""
    f = x1 - fold
    return (path(f"M{x0} {y0} H{f} L{x1} {y0 + fold} V{y1} H{x0} Z", fill)
            + path(f"M{f} {y0} V{y0 + fold} H{x1} Z", MID if fill == PALE else PALE))


def badge(*content):
    """Bottom-right badge slot, knocked out of whatever is underneath."""
    return gap(12, 12, 8, 8) + "".join(content)


def file_with(*badge_content):
    return tile(page(5, 4, 17, 20), badge(*badge_content))


def squares(n=3, size=8, step=4, x=4, y=4):
    """Web Display stack: back square top-right, front (PALE) bottom-left."""
    fills = [PALE, MID, PALE][-n:]
    out = []
    for i in range(n):
        sx, sy = x + step * (n - 1 - i), y + step * i
        out.append(gap(sx, sy, size, size) + rect(sx, sy, size, size, fills[i]))
    return "".join(out)


# ============================================================================
# FileIO / ComputeIO
# ============================================================================

def i_bake_file():
    # Down arrow into a tray: written to disk.
    return file_with(rect(12, 12, 8, 8, MID), path("M14 13 H18 V15 H20 L16 19 L12 15 H14 Z", PALE))


def i_block_to_file():
    return file_with(rect(12, 12, 8, 8, MID), rect(14, 14, 4, 4, TILE, 0))


def i_geometry_to_file():
    return file_with(path("M16 12 L20 20 H12 Z", MID))


def i_path_to_file():
    # Folder: the file comes from a location on disk.
    return file_with(path("M12 13 H15 L16 14 H20 V20 H12 Z", MID))


def i_color_input():
    cx, cy, r, apex = 12, 14.5, 5.5, 4
    d = cy - apex
    a = math.asin(r / d)
    tx, ty = r * math.cos(a), cy - r * math.sin(a)
    return tile(path(f"M{cx} {apex} L{cx + tx:.3f} {ty:.3f} A{r} {r} 0 1 1 {cx - tx:.3f} {ty:.3f} Z"))


def i_get_value_list():
    # Dropdown: field with a chevron, an open list below it.
    return tile(rect(4, 4, 16, 6),
                path("M14 6 H18 L16 8 Z", TILE),
                rect(4, 12, 16, 3, MID, 0.5),
                rect(4, 17, 11, 3, PALE, 0.5))


def i_environment():
    # Two rack units with a status slot each.
    return tile(rect(4, 5, 16, 6, MID), rect(6, 7, 4, 2, PALE, 0),
                rect(4, 13, 16, 6, PALE), rect(6, 15, 4, 2, TILE, 0))


# ============================================================================
# UI
# ============================================================================

def i_ui_bridge():
    # Inputs on the left, the rendered page on the right.
    return tile(rect(4, 4, 6, 7), rect(4, 13, 6, 7, MID),
                rect(12, 4, 8, 16), rect(14, 6, 4, 12, TILE, 0))


def i_prepare_ui_inputs():
    # A slider over a toggle: the canvas controls this component registers.
    return tile(rect(4, 6, 16, 2, PALE, 0),
                gap(12, 4, 4, 6), rect(12, 4, 4, 6, MID),
                rect(4, 13, 12, 7, PALE, 3.5),
                circle(12.5, 16.5, 2.5, MID))


# ============================================================================
# Display
# ============================================================================

def i_web_display():
    return tile(squares(3, 8, 4))


def i_param_web_display():
    return param(squares(2, 6, 3, x=7, y=7))


def i_display_to_file():
    return tile(squares(2, 9, 4), badge(page(13, 12, 20, 20, PALE, 3)))


def i_display_from_file():
    return tile(page(4, 4, 15, 20), badge(rect(15, 12, 5, 5, MID), gap(12, 15, 5, 5), rect(12, 15, 5, 5)))


def i_display_size():
    return tile(squares(2, 7, 4, x=6, y=4),
                rect(4, 16, 2, 4, MID, 0), rect(18, 16, 2, 4, MID, 0),
                rect(6, 17, 12, 2, PALE, 0))


def i_deconstruct_display():
    return tile(rect(4, 8, 7, 8, MID),
                rect(13, 4, 7, 4), rect(13, 10, 7, 4, MID), rect(13, 16, 7, 4))


ICONS = {
    "BakeFile": i_bake_file, "BlockToFile": i_block_to_file,
    "GeometryToFile": i_geometry_to_file, "PathToFile": i_path_to_file,
    "ColorInput": i_color_input, "GetValueList": i_get_value_list, "Environment": i_environment,
    "UIBridge": i_ui_bridge, "PrepareUIInputs": i_prepare_ui_inputs,
    "WebDisplay": i_web_display, "ParamWebDisplay": i_param_web_display,
    "DisplayToFile": i_display_to_file, "DisplayFromFile": i_display_from_file,
    "DisplaySize": i_display_size, "DeconstructDisplay": i_deconstruct_display,
}


# ============================================================================
# Badge glyphs: one meaning each, reused across families
# ============================================================================

def b_plus():
    """Create."""
    return rect(12, 12, 8, 8, MID) + rect(15, 13, 2, 6, PALE, 0) + rect(13, 15, 6, 2, PALE, 0)


def b_up():
    """Get: arrives from the web UI."""
    return rect(12, 12, 8, 8, MID) + path("M16 13 L20 17 H18 V19 H14 V17 H12 Z", PALE)


def b_down():
    """Set / write out."""
    return rect(12, 12, 8, 8, MID) + path("M14 13 H18 V15 H20 L16 19 L12 15 H14 Z", PALE)


def b_server():
    return rect(12, 12, 8, 3, MID, 0.5) + rect(12, 17, 8, 3, MID, 0.5) + rect(13, 13, 2, 1, PALE, 0) + rect(13, 18, 2, 1, PALE, 0)


def b_bolt():
    """Dynamic: computed at runtime."""
    return path("M18 12 L12 17 H15.5 L14 20 L20 15 H16.5 L18 12 Z", PALE)


def b_lens():
    """Inspect."""
    return (f'<circle cx="15" cy="15" r="2.5" fill="none" stroke="{PALE}" stroke-width="2"/>'
            + stroke("M17 17 L20 20", PALE, 2))


def b_merge():
    return stroke("M13 12 V14 L16 17 L19 14 V12 M16 17 V20", PALE, 2)


def b_glow():
    """Emissive: a bright core inside its halo."""
    return circle(16, 16, 4, MID) + circle(16, 16, 3, TILE) + circle(16, 16, 2)


def b_swatches():
    """Preset: a palette of fixed choices."""
    return rect(12, 12, 3.5, 3.5, PALE, 0.5) + rect(16.5, 12, 3.5, 3.5, MID, 0.5) + rect(12, 16.5, 3.5, 3.5, MID, 0.5) + rect(16.5, 16.5, 3.5, 3.5, PALE, 0.5)


def param(*content):
    """Parameters drop the tile for a dark hexagon, as Grasshopper draws its own parameter icons."""
    ring = " ".join(f"{12 + 10 * math.cos(math.radians(a)):.3f} {12 + 10 * math.sin(math.radians(a)):.3f}"
                    for a in range(0, 360, 60))
    return f'<path d="M{ring} Z" fill="{TILE}"/>' + "".join(content)


def picture(x0, y0, x1, y1):
    """Image: frame with a mountain and a sun knocked out."""
    return (rect(x0, y0, x1 - x0, y1 - y0)
            + path(f"M{x0 + 2} {y1 - 2} L{x0 + 6} {y1 - 7} L{x0 + 9} {y1 - 4} L{x0 + 10} {y1 - 5} L{x1 - 2} {y1 - 2} Z", TILE)
            + circle(x1 - 4, y0 + 4, 1.5, TILE))


# ============================================================================
# Shared-icon splits
# ============================================================================

def i_create_file():
    return file_with(b_plus())


def i_get_file():
    return file_with(b_up())


def i_get_server_file():
    return file_with(b_server())


def i_param_file_data():
    return param(page(8, 6, 16, 18, PALE, 3))


def i_get_image():
    return tile(picture(4, 4, 18, 16), badge(b_up()))


def i_get_dynamic_value_list():
    return tile(rect(4, 4, 16, 6), path("M14 6 H18 L16 8 Z", TILE), rect(4, 12, 7, 3, MID, 0.5),
                rect(4, 17, 6, 3, PALE, 0.5), badge(b_bolt()))


def i_set_dynamic_value_list():
    return tile(rect(4, 4, 16, 6), path("M14 6 H18 L16 8 Z", TILE), rect(4, 12, 7, 3, MID, 0.5),
                rect(4, 17, 6, 3, PALE, 0.5), badge(b_down()))


def i_evaluate_schema():
    return tile(rect(4, 4, 6, 7), rect(4, 13, 6, 7, MID), rect(12, 4, 8, 6),
                badge(b_lens()))


def i_combine_display():
    return tile(squares(2, 8, 4), badge(b_merge()))


ICONS.update({
    "CreateFile": i_create_file, "GetFile": i_get_file, "GetServerFile": i_get_server_file,
    "ParamFileData": i_param_file_data, "GetImage": i_get_image,
    "GetDynamicValueList": i_get_dynamic_value_list, "SetDynamicValueList": i_set_dynamic_value_list,
    "EvaluateSchema": i_evaluate_schema, "CombineDisplay": i_combine_display,
})

# ============================================================================
# Drawing (PDF / SVG output)
# ============================================================================
# No tile: glyphs fill 2..22 and main() adds a 1px TILE casing around their silhouette, so
# they read on both backgrounds without a tile eating a quarter of the canvas. TILE shapes
# inside a glyph stay knockouts.

def d_page():
    return rect(5, 2, 14, 20)


def d_document():
    # Page plus one behind it: Document is "pages", Page is one.
    return rect(9, 2, 13, 14, MID) + gap(3, 8, 12, 13) + rect(3, 8, 12, 13)


def d_frame():
    return stroke("M3 3 H21 V21 H3 Z", MID) + rect(8, 8, 8, 8)


def d_title_block():
    return stroke("M3 3 H21 V21 H3 Z", PALE) + rect(12, 14, 10, 8) + rect(12, 17, 10, 1, TILE, 0)


def d_layout_override():
    # Page whose header and footer bands are replaced.
    return stroke("M4 3 H20 V21 H4 Z", PALE) + rect(7, 6, 10, 4, MID, 0) + rect(7, 14, 10, 4, MID, 0)


def d_document_info():
    return page(3, 2, 21, 22, PALE, 5) + rect(11, 7, 2, 2, TILE, 0) + rect(11, 11, 2, 7, TILE, 0)


def d_render_pdf():
    # Page knocked out with text lines: a laid-out document.
    return (page(3, 2, 21, 22, PALE, 5) + rect(6, 9, 12, 2, TILE, 0) + rect(6, 13, 12, 2, TILE, 0)
            + rect(6, 17, 7, 2, TILE, 0))


def d_render_svg():
    # Page knocked out with a vector path and its two anchors.
    return (page(3, 2, 21, 22, PALE, 5) + stroke("M7 18 C9 9 13 20 17 10", TILE, 2)
            + rect(5, 16, 4, 4, MID, 0) + rect(15, 8, 4, 4, MID, 0))


def d_stack():
    return rect(2, 2, 20, 6) + rect(2, 9, 20, 6, MID) + rect(2, 16, 20, 6)


def d_text_flow():
    # Ragged lines stopping at a width limit.
    return rect(20, 2, 2, 20, MID, 0) + "".join(rect(2, y, w, 2, PALE, 0) for y, w in ((3, 16), (8, 16), (13, 16), (18, 9)))


def d_table():
    return (rect(2, 2, 20, 6) + rect(2, 10, 9, 5, MID, 0.5) + rect(13, 10, 9, 5, MID, 0.5)
            + rect(2, 17, 9, 5, MID, 0.5) + rect(13, 17, 9, 5, MID, 0.5))


def d_revision_table():
    # Rev-letter column beside a description column.
    return "".join(rect(2, y, 5, 6, MID, 0.5) + rect(9, y, 13, 6, PALE, 0.5) for y in (2, 9, 16))


def d_grid():
    return circle(6.5, 6.5, 4.5) + rect(13, 2, 9, 9, MID) + rect(2, 13, 9, 9, MID) + circle(17.5, 17.5, 4.5)


def style_bars(y0, weights, gap=2):
    """Stroke weights, heaviest first."""
    out, y = [], y0
    for h, c in weights:
        out.append(rect(2, y, 20, h, c, 0))
        y += h + gap
    return "".join(out)


def d_path_style():
    return rect(2, 2, 20, 5, PALE, 0) + style_bars(9, ((4, PALE), (3, MID), (2, MID)))


def d_text_style():
    return (rect(2, 2, 10, 3, PALE, 0) + rect(6, 5, 2, 7, PALE, 0) + rect(14, 6, 8, 3, MID, 0)
            + style_bars(15, ((3, PALE), (2, MID))))


def d_draw_text():
    return rect(3, 3, 18, 5, PALE, 0) + rect(10, 8, 4, 13, PALE, 0)


def d_draw_surface():
    return f'<path d="M3 3 H21 V21 H3 Z M7 8 V16 H17 V8 Z" fill-rule="evenodd" fill="{PALE}"/>'


def d_draw_curve():
    return stroke("M4 20 C6 5 11 5 12 12 C13 19 16 18 17 11", PALE, 2, "round") + circle(18, 8, 3, MID)


def d_draw_leader():
    # Arrowhead at the target, leader, shoulder, then the note it labels.
    return (path("M2 22 L3.5 15.5 L8.5 20.5 Z", MID) + stroke("M5.5 18.5 L12 12 H22", PALE, 2)
            + rect(13, 3, 9, 6, PALE, 0.5))


def diamond(cx, cy, h, hole=0):
    d = f"M{cx} {cy - h} L{cx + h} {cy} L{cx} {cy + h} L{cx - h} {cy} Z"
    if hole:
        d += f" M{cx} {cy - hole} L{cx - hole} {cy} L{cx} {cy + hole} L{cx + hole} {cy} Z"
    return f'<path d="{d}" fill-rule="evenodd" fill="{PALE}"/>'


def d_draw_symbol():
    return diamond(7, 7, 4.5) + diamond(17, 12, 4.5, 2) + diamond(7, 17, 4.5, 2)


def d_drawing_view():
    # Model geometry projected onto the sheet, caption below.
    return (rect(2, 2, 20, 13, MID) + circle(8, 8.5, 3.5) + rect(14, 6, 5, 6, PALE, 0.5)
            + rect(2, 18, 13, 4, PALE, 0.5))


def d_draw_image():
    return picture(2, 3, 22, 21)


def d_linear_dimension():
    return (rect(2, 4, 2, 16, MID, 0) + rect(20, 4, 2, 16, MID, 0)
            + path("M4 12 L8 8 V11 H16 V8 L20 12 L16 16 V13 H8 V16 Z"))


def d_angular_dimension():
    # Obtuse angle so the arc reads as a dome; it is centred on the vertex and lands on both legs.
    vx, vy, r = 12, 21, 9
    ex, ey = vx + r * math.cos(math.radians(135)), vy - r * math.sin(math.radians(135))
    return (rect(2, 20, 20, 2, PALE, 0) + stroke(f"M{vx} {vy} L3 11", PALE, 2)
            + f'<path d="M{vx + r} {vy - 1} A{r} {r} 0 0 0 {ex:.3f} {ey:.3f}" fill="none" stroke="{MID}" stroke-width="2"/>')


def d_legend_block():
    return (rect(2, 2, 6, 6) + circle(5, 12, 3, MID) + diamond(5, 19, 3)
            + rect(10, 4, 12, 2, PALE, 0) + rect(10, 11, 12, 2, PALE, 0) + rect(10, 18, 8, 2, PALE, 0))


def d_notes_block():
    return "".join(rect(2, y, 3, 3, MID, 0) + rect(7, y, w, 3, PALE, 0.5) for y, w in ((3, 15), (10, 15), (17, 9)))


DRAWING = {
    "Page": d_page, "Document": d_document, "Frame": d_frame, "TitleBlock": d_title_block,
    "LayoutOverride": d_layout_override, "DocumentInfo": d_document_info, "RenderPdf": d_render_pdf,
    "RenderSvg": d_render_svg, "Stack": d_stack, "TextFlow": d_text_flow, "Table": d_table,
    "RevisionTable": d_revision_table, "Grid": d_grid, "PathStlye": d_path_style, "TextStyle": d_text_style,
    "DrawText": d_draw_text, "DrawSurface": d_draw_surface, "DrawCurve": d_draw_curve,
    "DrawLeader": d_draw_leader, "DrawSymbol": d_draw_symbol, "DrawingView": d_drawing_view,
    "DrawImage": d_draw_image, "LinearDimension": d_linear_dimension,
    "AngularDimension": d_angular_dimension, "LegendBlock": d_legend_block, "NotesBlock": d_notes_block,
}


# Variants of the hand-made ThreeMaterial sphere: its gradient isn't generated, so the badge is
# composited over the PNG.
OVERLAYS = {"EmissiveMaterial": ("ThreeMaterial", b_glow), "MaterialPreset": ("ThreeMaterial", b_swatches)}


def render(svg, size=24, ss=8):
    data = bytes(resvg_py.svg_to_bytes(svg_string=svg, width=size * ss, height=size * ss))
    return Image.open(io.BytesIO(data)).convert("RGBA").resize((size, size), Image.BOX)


def cased(svg, size=24, ss=8):
    """Glyph over a 1px TILE casing that follows its silhouette."""
    data = bytes(resvg_py.svg_to_bytes(svg_string=svg, width=size * ss, height=size * ss))
    art = Image.open(io.BytesIO(data)).convert("RGBA")
    out = Image.new("RGBA", art.size, TILE)
    out.putalpha(art.split()[3].filter(ImageFilter.MaxFilter(2 * ss + 1)))
    out.alpha_composite(art)
    return out.resize((size, size), Image.BOX)


def main():
    only = set(sys.argv[1:])
    for name, fn in {**ICONS, **DRAWING}.items():
        if only and name not in only:
            continue
        svg = f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">{fn()}</svg>\n'
        with open(os.path.join(OUT, name + ".svg"), "w", encoding="utf-8") as f:
            f.write(svg)
        (cased if name in DRAWING else render)(svg).save(os.path.join(OUT, name + ".png"))
    for name, (base, glyph) in OVERLAYS.items():
        if only and name not in only:
            continue
        svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">'
               f'{rect(10, 10, 12, 12, TILE, 3)}{glyph()}</svg>\n')
        img = Image.open(os.path.join(OUT, base + ".png")).convert("RGBA")
        img.alpha_composite(render(svg))
        img.save(os.path.join(OUT, name + ".png"))


if __name__ == "__main__":
    main()
