# Compuceraptor - Overview

## What is Compuceraptor?

Compuceraptor is a Grasshopper plugin that bridges the gap between Rhino 3D and the web. It enables designers and
engineers to export their 3D geometry to various file formats and prepare models for interactive web visualization—all
directly from within Grasshopper.

### Key Capabilities

**1. Flexible Geometry Export**

- Export your Grasshopper geometry to multiple file formats (3dm and more)
- Organize geometry into layers with custom names and colors
- Process single models or batch-export multiple files at once
- All exported data is encoded and ready for digital transmission or storage

**2. Web-Ready 3D Visualization**

- Convert Rhino geometry to Three.js format for interactive web viewing
- Add materials with realistic properties (color, metalness, roughness, transparency)
- Automatically optimizes meshes for web performance
- Output is compressed and ready for web deployment

**3. Seamless Workflow Integration**

- Works directly within Grasshopper's familiar canvas interface
- Handles complex data trees for batch processing
- Provides clear feedback and warnings during processing
- Compatible with all standard Grasshopper geometry types

---

## Technical Overview

#### Component Categories

**IO Components**

- **DataToFile**: Exports geometry to various file formats with comprehensive layer management
  - Supports single-file and multi-file export modes via data tree processing
  - Base64 encoding for network-safe transmission
  - Configurable file naming and organization
  - Memory-efficient streaming for large files (>10MB)

**Display Components**

- **WebDisplay**: Converts geometry to Three.js-compatible mesh data
  - Asynchronous processing to prevent UI blocking
  - Parallel mesh conversion for optimal performance
  - Automatic mesh optimization and compression (GZip + Base64)
  - Supports triangles and quads with accurate vertex/face counting

- **ThreeMaterial**: Material definition system for web rendering
  - PBR (Physically Based Rendering) parameters: metalness, roughness, opacity
  - Full transparency support
  - Color management with web-standard serialization

### Technology Stack

**Target Platforms**

- Rhino 7 (.NET Framework 4.8)
- Rhino 8 (.NET 7.0) - Windows and macOS

**Core Dependencies**

- Grasshopper SDK 8.0
- Newtonsoft.Json for serialization
- Microsoft.Extensions.Logging for structured logging
- System.Drawing.Common for color management

### Component Design Patterns

**Data Type System**

- Custom Goo wrappers: `FileDataGoo`, `ThreeMaterialGoo`, `ThreeDisplayGoo`
- Full serialization/deserialization support
- Type casting and validation
- Deep copy semantics

### Geometry Processing Pipeline

**Export Pipeline**

1. Extract and validate geometry from Grasshopper types
2. Create headless Rhino document
3. Organize geometry into layers (names, colors)
4. Export to target format via Rhino's native exporters
5. Convert to Base64 for transport
6. Wrap in custom data type with metadata

**Display Pipeline**

1. Parallel extraction of valid geometries
2. Parallel mesh generation with custom parameters
3. Mesh decomposition (triangles/quads)
4. Vertex/face array conversion (float precision for web efficiency)
5. Material property reflection and copying
6. GZip compression and Base64 encoding
7. Package as ThreeDisplay objects
