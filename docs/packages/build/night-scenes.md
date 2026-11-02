---
title: Night scenes
order: 8
published: true
description: 'Make parts of a model glow, and let them light the scene in the Night look.'
---

# Night scenes

Lamps, screens and lit windows can glow in the viewer. In the Night look, the strongest glowing parts also light the scene and cast shadows.

1. **Add an Emissive Material** from the Selva Display tab. Set its **Color** and **Strength**: around 1 is a lit surface, 4 a lamp. To make an existing material glow, wire it into **Base**.
2. **Wire it into Display's Material input**, as with any other material.
3. **Open in Night.** In the UI builder, set Settings → Viewer → **Starting look** to Night. Anyone can also switch look from the viewer's display menu.

Wire a slider or toggle into **Strength** to let people dim the light. A strength of 0 turns it off.

## Real lamps

To match a datasheet, use **Kelvin** and **Lumens** instead of Color and Strength. Kelvin gives the blackbody colour as an eye adapted to the room sees it: 2700 warm, 4000 neutral, 6500 cool. Lumens drive real light levels, in any document units: doubling the flux doubles the light.

The viewer is a preview, not a photometric simulation. Light spreads evenly from a point, without a lamp's beam shape or light bouncing off walls. Compare options against each other, and use a lighting tool for sign-off.

## Built-in surfaces

**Material Preset** includes Wood, Walnut, Concrete, Brick, Plaster and Corten steel, with no texture files. They're drawn at real size, so a brick is 215 x 65 mm. To use one in your own colour, wire a Material Preset into Three Material's **Base**, then wire **Color**. Three Material's **Finish** input picks the same surfaces.

## Getting a good result

- **Put the source inside its housing.** Light leaves from the middle of the glowing part, and the rest of the model blocks it. A bulb inside a shade throws a pool of light; a glowing shade lights everything.
- **Separate sources from glowing surfaces.** Anything under a third of the strongest strength glows but casts no light. Give a frosted diffuser about 0.3 of its bulb.
- **Light a building with some of its windows.** Split the glazing into two groups, and give only the lit ones an Emissive Material.
- **Three sources at most cast light,** the strongest first. Each one costs rendering time, so a street of lamps should glow instead.
- **Phones get a lighter Night:** one source casts light, with no bloom or contact shading, at a lower resolution. Check a design with several lamps on a phone.

[`studio_task_lamp.gh`](https://github.com/vektornode/selva/tree/main/examples/definitions) and `block_massing_studio.gh` show both patterns.
