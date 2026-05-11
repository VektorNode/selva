// using System;
// using System.Collections.Generic;
// using System.Drawing;
// using Grasshopper.Kernel;
// using Selva.Drawing.Model.Drawings;
// using Selva.Drawing.Model.Geometry;
// using Selva.GH.Properties;

// namespace Selva.GH.Features.Drawing.Components;

// // Phase 8 composite component: numbered notes block. Each note becomes a wrapped paragraph
// // preceded by an auto-generated "1." marker (or a custom marker from the parallel input).
// public class GH_NotesBlock : GH_Component
// {
//     public GH_NotesBlock()
//         : base("Notes Block", "Notes",
//             "Numbered, wrapped notes with optional title",
//             "Selva", "Layout")
//     {
//     }

//     protected override Bitmap Icon => Resources.NotesBlock;
//     public override GH_Exposure Exposure => GH_Exposure.quarternary;
//     public override Guid ComponentGuid => new Guid("63FCFB53-2BC4-40C7-AAA9-EF3B9A808EE1");

//     protected override void RegisterInputParams(GH_InputParamManager pManager)
//     {
//         pManager.AddTextParameter("Title", "T", "Optional block title (leave empty for none)", GH_ParamAccess.item, "");
//         pManager.AddTextParameter("Notes", "N", "List of note paragraphs", GH_ParamAccess.list);
//         pManager.AddTextParameter("Markers", "M", "Optional custom markers (parallel to Notes; defaults to \"1.\", \"2.\")", GH_ParamAccess.list);
//         pManager.AddNumberParameter("Width", "W", "Block width in millimetres", GH_ParamAccess.item, 90.0);
//         pManager.AddNumberParameter("Gutter", "G", "Width of the marker column in millimetres", GH_ParamAccess.item, 6.0);
//         pManager.AddPointParameter("Origin", "O", "Bottom-left in world coordinates", GH_ParamAccess.item, new Rhino.Geometry.Point3d(0, 0, 0));

//         pManager[0].Optional = true;
//         pManager[1].Optional = true;
//         pManager[2].Optional = true;
//         pManager[3].Optional = true;
//         pManager[4].Optional = true;
//         pManager[5].Optional = true;
//     }

//     protected override void RegisterOutputParams(GH_OutputParamManager pManager)
//     {
//         pManager.AddGenericParameter("Element", "E", "Drawing element", GH_ParamAccess.item);
//     }

//     protected override void SolveInstance(IGH_DataAccess DA)
//     {
//         var title = "";
//         var notes = new List<string>();
//         var markers = new List<string>();
//         var width = 90.0;
//         var gutter = 6.0;
//         var origin = new Rhino.Geometry.Point3d(0, 0, 0);

//         DA.GetData(0, ref title);
//         DA.GetDataList(1, notes);
//         DA.GetDataList(2, markers);
//         DA.GetData(3, ref width);
//         DA.GetData(4, ref gutter);
//         DA.GetData(5, ref origin);

//         var block = new NotesBlock
//         {
//             Title = title,
//             Notes = notes,
//             Markers = markers.Count == notes.Count ? (IReadOnlyList<string>)markers : null,
//             Width = Math.Max(20, width),
//             GutterWidth = Math.Max(2, gutter),
//             Origin = new Point2D(origin.X, origin.Y),
//         };

//         DA.SetData(0, block);
//     }
// }
