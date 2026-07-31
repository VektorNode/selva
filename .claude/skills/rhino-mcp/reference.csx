// C# snippets for the Rhino MCP `run_csharp` tool.
//
// Not compiled, not referenced by any build — a paste library.
// Context and traps: SKILL.md (same directory)
//
// Verified against Rhino 8.33 / Grasshopper 1.0.0008 / Rhino MCP Platform 0.1.5.
//
// `run_csharp` provides no implicit `using System`, so every snippet declares its own usings.
// The CS1701 System.Windows.Forms version warning it prints is harmless.

// ============================================================================
// Resolve a component Guid
// ============================================================================
// Confirms a Guid is registered before you try to place it. Third-party Guids
// resolve here exactly like stock ones once their .gha is loaded.

using System;

var server = Grasshopper.Instances.ComponentServer;
foreach (var s in new string[] {
    "2e78987b-9dfb-42a2-8b76-3923ac8bd91a", // Boolean Toggle (stock)
    "593bc967-797a-4b1a-9b76-c2133f6b08e2", // UI Bridge (Selva.GH)
    "ae2531b4-bab2-4bb1-b5bf-f2143d10c132", // Context Bake (Hops)
}) {
    var proxy = server.EmitObjectProxy(new Guid(s));
    Console.WriteLine(s + " -> " + (proxy == null ? "NULL" : proxy.Desc.Name + " | " + proxy.Type.FullName));
}

// ============================================================================
// Enumerate a plugin's components
// ============================================================================
// g1_search_components matches Description as well as Name, so searching
// "Selva" returns anything mentioning Selva in prose — not a category listing.
// Filter the registry directly instead.
//
// Obsolete variants share their live component's name (Selva has 17 of them),
// so this is also how you tell which Guid is the current one.

using System;
using System.Linq;

var server = Grasshopper.Instances.ComponentServer;
var proxies = server.ObjectProxies
    .Where(p => p.Desc.Category == "Selva")
    .OrderBy(p => p.Desc.SubCategory).ThenBy(p => p.Desc.Name)
    .ToList();

Console.WriteLine("total=" + proxies.Count + " live=" + proxies.Count(p => !p.Obsolete));
foreach (var p in proxies.Where(p => !p.Obsolete))
    Console.WriteLine(p.Desc.SubCategory + " | " + p.Desc.Name + " | " + p.Desc.NickName + " | " + p.Guid);

// ============================================================================
// Place and wire — the g1_apply_graph replacement
// ============================================================================
// apply_graph and g1_connect are broken in 0.1.5; this is the working path.
// Params resolve by Name, then NickName, then numeric index.

using System;
using System.Linq;
using Grasshopper.Kernel;

var server = Grasshopper.Instances.ComponentServer;
var doc = Grasshopper.Instances.ActiveCanvas.Document;

Func<string, float, float, IGH_DocumentObject> place = (guid, x, y) => {
    var obj = server.EmitObjectProxy(new Guid(guid)).CreateInstance();
    obj.CreateAttributes();
    obj.Attributes.Pivot = new System.Drawing.PointF(x, y);
    doc.AddObject(obj, false);
    return obj;
};

Func<IGH_DocumentObject, string, bool, IGH_Param> pick = (o, sel, wantInput) => {
    if (o is IGH_Param p) return p;
    var comp = o as IGH_Component;
    var list = wantInput
        ? comp.Params.Input.Cast<IGH_Param>().ToList()
        : comp.Params.Output.Cast<IGH_Param>().ToList();
    int idx;
    if (int.TryParse(sel, out idx)) return list[idx];
    return list.FirstOrDefault(q => string.Equals(q.Name, sel, StringComparison.OrdinalIgnoreCase))
        ?? list.FirstOrDefault(q => string.Equals(q.NickName, sel, StringComparison.OrdinalIgnoreCase));
};

var bridge = place("593bc967-797a-4b1a-9b76-c2133f6b08e2", 260, 100);
var bake = place("ae2531b4-bab2-4bb1-b5bf-f2143d10c132", 520, 100);

// Downstream input takes the upstream output as a source.
pick(bake, "0", true).AddSource(pick(bridge, "Schema", false));

doc.NewSolution(false);
Console.WriteLine("objects=" + doc.ObjectCount);

// ============================================================================
// Save a Grasshopper definition
// ============================================================================
// GH_Document.SaveAs does not exist in this build; save_doc is the Rhino doc.
// FilePath must be set first or the archive's Name item is written empty.
// The Thumbnail chunk is what Grasshopper's own save adds as a second root chunk.

using System;

var canvas = Grasshopper.Instances.ActiveCanvas;
var doc = canvas.Document;
var path = @"d:\Coding\selva\fixtures\grasshopper\example.ghx";
doc.FilePath = path;

var size = Grasshopper.GUI.Canvas.GH_Canvas.ThumbnailSize; // static, not an instance member
var bmp = new System.Drawing.Bitmap(size.Width, size.Height);
canvas.DrawToBitmap(bmp, new System.Drawing.Rectangle(0, 0, size.Width, size.Height));
doc.Thumbnail = bmp;

var archive = new GH_IO.Serialization.GH_Archive();
archive.AppendObject(doc, "Definition");
archive.CreateTopLevelNode("Thumbnail").SetDrawingBitmap("Thumbnail", doc.Thumbnail);
Console.WriteLine("written=" + archive.WriteToFile(path, true, false));

// ============================================================================
// Place a bare UI Bridge (no auto-scaffold)
// ============================================================================
// Placing a UI Bridge normally adds a Boolean Toggle and a Context Bake beside
// it — good for humans, wrong for a scripted build. SuppressAutoWire() is the
// component's own opt-out (Selva >= 0.16.1); the flag is [ThreadStatic], so the
// AddObject call must happen inside the using block.

using System;
using System.Linq;
using System.Reflection;

var doc = Grasshopper.Instances.ActiveCanvas.Document;
var server = Grasshopper.Instances.ComponentServer;
var suppress = AppDomain.CurrentDomain.GetAssemblies()
    .First(a => a.GetName().Name == "Selva")
    .GetType("Selva.GH.Features.UIBuilder.Components.GH_UIBuilderComponent")
    .GetMethod("SuppressAutoWire", BindingFlags.Public | BindingFlags.Static);

using ((IDisposable)suppress.Invoke(null, null))
{
    var bridge = server.EmitObjectProxy(new Guid("593bc967-797a-4b1a-9b76-c2133f6b08e2")).CreateInstance();
    bridge.CreateAttributes();
    bridge.Attributes.Pivot = new System.Drawing.PointF(260, 100);
    doc.AddObject(bridge, false);
}
doc.NewSolution(false);
Console.WriteLine("objects=" + doc.ObjectCount); // 1, not 3

// ============================================================================
// Graft an embedded UI schema onto a UI Bridge
// ============================================================================
// A freshly-placed UI Bridge has no schema — it reads "Offline • No Schema" and
// saves without the Container chunk's Schema item.
//
// Selva >= 0.16.1 exposes `public UISchema Schema { get; set; }`, so prefer:
//     bridge.GetType().GetProperty("Schema").SetValue(bridge, schema);
// (still via reflection only because the script sandbox can't reference
// Selva.Schema — the property itself is public, and the setter expires the
// solution for you.) The _embeddedSchema field write below is the fallback for
// older builds; both persist identically through Write().
//
// The sandbox can't reference Selva.Schema or Newtonsoft directly, hence the
// reflection: both types are pulled off the already-loaded assemblies.
//
// Shape is authoritative in packages/schemas/ui-schema.json. Validate the JSON
// BEFORE grafting — `validate-ui-schema.mjs <file>` (alongside this file) catches all of
// the traps below, none of which surface at runtime:
//   - nesting is layout.tabs[] -> groups[] -> items[]  (a tab has no "items")
//   - items key on paramId (not inputId) and need BOTH type + widgetType
//   - paramType values are lowercase: "number", not "Number" (Newtonsoft binds
//     enums case-insensitively, so the wrong casing deserializes silently)
// Get either wrong and the JSON still parses — the item is just dropped.

using System;
using System.Linq;
using System.Reflection;

var doc = Grasshopper.Instances.ActiveCanvas.Document;
var bridge = doc.Objects.First(o => o.Name == "UI Bridge");
var schemaProp = bridge.GetType().GetProperty("Schema");

var json = @"{
""id"":""aaaaaaaa-1111-2222-3333-444444444444"",
""name"":""Rich Fixture"",""description"":"""",""projectFileName"":"""",
""documentId"":""DOCID"",""pluginVersion"":""0.16.0.0"",""tags"":[],""schemaVersion"":""2.12.0"",
""created"":""2026-07-31T10:07:55.9981667Z"",""lastModified"":""2026-07-31T10:08:14.0160885Z"",
""viewerOptions"":{""enableLocal"":false,""enableRemote"":false,""backgroundColor"":""#f3f3f3""},
""instanceSolve"":true,
""inputs"":[
 {""id"":""11111111-0000-0000-0000-000000000001"",""nickname"":""Width"",""paramType"":""number"",""default"":3.5},
 {""id"":""11111111-0000-0000-0000-000000000002"",""nickname"":""Label"",""paramType"":""text"",""default"":""hello""}
],
""outputs"":[{""id"":""22222222-0000-0000-0000-000000000001"",""nickname"":""Result"",""paramType"":""generic""}],
""layout"":{""type"":""tabbed"",""gap"":16,""tabs"":[
 {""id"":""tab-1"",""label"":""Main"",""groups"":[
   {""id"":""grp-1"",""label"":""Dimensions"",""items"":[
     {""id"":""item-1"",""paramId"":""11111111-0000-0000-0000-000000000001"",""type"":""input"",""widgetType"":""number"",""displayName"":""Width""},
     {""id"":""item-2"",""paramId"":""11111111-0000-0000-0000-000000000002"",""type"":""input"",""widgetType"":""text"",""displayName"":""Label""}
   ]}
 ]}
]}}";
json = json.Replace("DOCID", doc.DocumentID.ToString()); // never reuse another fixture's documentId

var jsonConvert = AppDomain.CurrentDomain.GetAssemblies()
    .First(a => a.GetName().Name == "Newtonsoft.Json")
    .GetType("Newtonsoft.Json.JsonConvert");
var deserialize = jsonConvert.GetMethods(BindingFlags.Public | BindingFlags.Static)
    .First(m => m.Name == "DeserializeObject" && m.IsGenericMethod && m.GetParameters().Length == 1)
    .MakeGenericMethod(schemaProp.PropertyType);

schemaProp.SetValue(bridge, deserialize.Invoke(null, new object[] { json })); // setter expires the solution
bridge.NickName = "UI Bridge"; // a fresh instance defaults to "UIBridge"
doc.NewSolution(false);
Console.WriteLine("schema=" + (schemaProp.GetValue(bridge) == null ? "NULL" : "ok"));

// ============================================================================
// Run the plugin's own SchemaValidator over a live component
// ============================================================================
// Semantic checks the JSON Schema can't make: orphaned params (an input defined
// but not placed in any group), missing widget config, version drift. Six rule
// classes; see Selva.Schema/Services/Validation/Rules/.
//
// Shape errors belong to `node .claude/skills/rhino-mcp/validate-ui-schema.mjs` — run that on the
// payload BEFORE grafting. This runs after, on what the component actually holds.

using System;
using System.Linq;
using System.Reflection;

var doc = Grasshopper.Instances.ActiveCanvas.Document;
var bridge = doc.Objects.First(o => o.Name == "UI Bridge");
var schema = bridge.GetType().GetProperty("Schema").GetValue(bridge);

var validatorType = AppDomain.CurrentDomain.GetAssemblies()
    .First(a => a.GetName().Name == "Selva.Schema")
    .GetType("Selva.Schema.Services.Validation.SchemaValidator");

var result = validatorType.GetMethod("Validate")
    .Invoke(Activator.CreateInstance(validatorType), new object[] { schema });

var rt = result.GetType();
Console.WriteLine("IsValid=" + rt.GetProperty("IsValid").GetValue(result));
foreach (var issue in (System.Collections.IEnumerable)rt.GetProperty("Issues").GetValue(result))
    Console.WriteLine("  [" + issue.GetType().GetProperty("Severity").GetValue(issue) + "] "
        + issue.GetType().GetProperty("Message").GetValue(issue));

// ============================================================================
// Verify a saved fixture by reloading it
// ============================================================================
// Save success is not proof the schema landed. Extract into a throwaway document
// and walk the structure — this is what caught tabs->items silently yielding 0.

using System;
using System.Linq;
using System.Reflection;

var archive = new GH_IO.Serialization.GH_Archive();
archive.ReadFromFile(@"d:\Coding\selva\fixtures\grasshopper\ui_bridge_minimal.ghx");
var fresh = new Grasshopper.Kernel.GH_Document();
archive.ExtractObject(fresh, "Definition");
Console.WriteLine("objects=" + fresh.ObjectCount);

var b = fresh.Objects.First(o => o.Name == "UI Bridge");
var fld = b.GetType().GetField("_embeddedSchema", BindingFlags.NonPublic | BindingFlags.Instance);
var schema = fld.GetValue(b);
var st = fld.FieldType;
Console.WriteLine("schema=" + (schema == null ? "NULL" : st.GetProperty("Name").GetValue(schema) + " v" + st.GetProperty("SchemaVersion").GetValue(schema)));

var layout = st.GetProperty("Layout").GetValue(schema);
var tabs = layout?.GetType().GetProperty("Tabs")?.GetValue(layout) as System.Collections.IEnumerable;
foreach (var tab in tabs ?? Enumerable.Empty<object>()) {
    var groups = tab.GetType().GetProperty("Groups")?.GetValue(tab) as System.Collections.IEnumerable;
    Console.WriteLine("tab '" + tab.GetType().GetProperty("Label").GetValue(tab) + "'");
    foreach (var g in groups ?? Enumerable.Empty<object>()) {
        var items = g.GetType().GetProperty("Items")?.GetValue(g) as System.Collections.IEnumerable;
        foreach (var i in items ?? Enumerable.Empty<object>())
            Console.WriteLine("    " + i.GetType().Name + " display=" + i.GetType().GetProperty("DisplayName")?.GetValue(i));
    }
}

// ============================================================================
// Reset the canvas between runs
// ============================================================================
// Toggling Selva's Enable starts the WebSocket server on 8765 — switch it back
// off and re-solve before clearing, or the server outlives the graph.

using System;
using System.Linq;

var doc = Grasshopper.Instances.ActiveCanvas.Document;

var toggle = doc.Objects.OfType<Grasshopper.Kernel.Special.GH_BooleanToggle>().FirstOrDefault();
if (toggle != null) { toggle.Value = false; toggle.ExpireSolution(true); }
doc.NewSolution(false);

foreach (var o in doc.Objects.ToList()) doc.RemoveObject(o, false);
doc.NewSolution(false);
Console.WriteLine("objects=" + doc.ObjectCount);

// ============================================================================
// Discover an API when a call fails to compile
// ============================================================================
// Faster than guessing at method names — this is how SaveAs was ruled out and
// CreateTopLevelNode / ThumbnailSize were found.

using System;
using System.Linq;

var t = typeof(GH_IO.Serialization.GH_Archive); // or typeof(Grasshopper.Kernel.GH_Document)
foreach (var m in t.GetMethods().Where(m => !m.Name.StartsWith("get_") && !m.Name.StartsWith("set_")))
    Console.WriteLine(m.ReturnType.Name + " " + m.Name + "("
        + string.Join(", ", m.GetParameters().Select(p => p.ParameterType.Name + " " + p.Name)) + ")");
