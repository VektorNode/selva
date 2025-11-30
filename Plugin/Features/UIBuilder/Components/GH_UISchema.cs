using System;
using System.Drawing;
using Grasshopper.Kernel;
using Selva.Features.UIBuilder.Models;

namespace Selva.Features.UIBuilder.Components;

/// <summary>
///   Creates a UISchema object for use in other components
/// </summary>
public class GH_UISchema : GH_Component
{
  public GH_UISchema()
    : base("UI Schema", "Schema",
      "Creates or deconstructs a UISchema object",
      "Selva", "UI")
  {
  }

  public override Guid ComponentGuid => new("8B5E2A9F-1C4D-4E7A-9B2C-3F8D5E6A7B9C");

  protected override Bitmap Icon => null;

  protected override void RegisterInputParams(GH_InputParamManager pManager)
  {
    pManager.AddTextParameter("Name", "N", "Schema name", GH_ParamAccess.item, "Untitled");
    pManager.AddTextParameter("Description", "D", "Schema description", GH_ParamAccess.item, "");
    pManager[1].Optional = true;
  }

  protected override void RegisterOutputParams(GH_OutputParamManager pManager)
  {
    pManager.AddGenericParameter("Schema", "S", "UISchema object", GH_ParamAccess.item);
  }

  protected override void SolveInstance(IGH_DataAccess DA)
  {
    var name = "Untitled";
    var description = "";

    DA.GetData(0, ref name);
    DA.GetData(1, ref description);

    var schema = new UISchema
    {
      Id = Guid.NewGuid().ToString(),
      Name = name,
      Description = description,
      Created = DateTime.UtcNow,
      LastModified = DateTime.UtcNow
    };

    DA.SetData(0, new UISchemaGoo(schema));
  }
}
