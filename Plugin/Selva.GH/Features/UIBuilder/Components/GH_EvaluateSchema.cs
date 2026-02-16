using System;
using System.Drawing;
using System.Linq;
using System.Text;
using Grasshopper.Kernel;
using Grasshopper.Kernel.Types;
using Newtonsoft.Json;
using Selva.Core.Models;
using Selva.GH.Features.UIBuilder.Models;
using Selva.GH.Properties;

namespace Selva.GH.Features.UIBuilder.Components;

public class GH_EvaluateSchema : GH_Component
{
	public GH_EvaluateSchema()
		: base("Evaluate Schema", "EvalSchema",
			"Inspects a UI Schema and provides detailed information and raw JSON",
			"Selva", "UI")
	{
	}

	public override Guid ComponentGuid => new("E7611CB2-9BAE-4A88-B47B-A94135394FA3");

	protected override Bitmap Icon => Resources.UIBridge; // Using same icon for now, or null if preferred

	public override GH_Exposure Exposure => GH_Exposure.hidden;

	protected override void RegisterInputParams(GH_InputParamManager pManager)
	{
		pManager.AddGenericParameter("Schema", "S", "The UI Schema to evaluate", GH_ParamAccess.item);
	}


	protected override void RegisterOutputParams(GH_OutputParamManager pManager)
	{
		pManager.AddTextParameter("Info", "I", "Human-readable summary of the schema", GH_ParamAccess.item);
		pManager.AddTextParameter("JSON", "J", "Raw JSON representation of the schema", GH_ParamAccess.item);
		pManager.AddIntegerParameter("Input Count", "IC", "Number of inputs in the schema", GH_ParamAccess.item);
		pManager.AddIntegerParameter("Output Count", "OC", "Number of outputs in the schema", GH_ParamAccess.item);
	}

	protected override void SolveInstance(IGH_DataAccess DA)
	{
		IGH_Goo schemaGoo = null;
		if (!DA.GetData(0, ref schemaGoo)) return;

		UISchema schema = null;

		// Try to extract UISchema from the input
		if (schemaGoo is UISchemaGoo uiSchemaGoo)
			schema = uiSchemaGoo.Value;
		else if (schemaGoo is GH_ObjectWrapper wrapper && wrapper.Value is UISchema wrappedSchema) schema = wrappedSchema;

		if (schema == null)
		{
			AddRuntimeMessage(GH_RuntimeMessageLevel.Error, "Input is not a valid UI Schema");
			return;
		}

		var sb = new StringBuilder();
		sb.AppendLine($"Schema: {schema.Name}");
		sb.AppendLine($"ID: {schema.Id}");
		sb.AppendLine($"Description: {schema.Description ?? "N/A"}");
		sb.AppendLine($"Created: {schema.Created}");
		sb.AppendLine($"Version: {schema.PluginVersion}");
		sb.AppendLine($"Inputs: {schema.Inputs?.Count ?? 0}");
		sb.AppendLine($"Outputs: {schema.Outputs?.Count ?? 0}");

		if (schema.Tags != null && schema.Tags.Any()) sb.AppendLine($"Tags: {string.Join(", ", schema.Tags)}");

		var json = JsonConvert.SerializeObject(schema, Formatting.Indented);

		DA.SetData(0, sb.ToString());
		DA.SetData(1, json);
		DA.SetData(2, schema.Inputs?.Count ?? 0);
		DA.SetData(3, schema.Outputs?.Count ?? 0);
	}
}
