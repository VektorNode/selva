using System;
using System.Collections.Generic;
using Newtonsoft.Json;

namespace ComputeBuilder.Models
{
    /// <summary>
    /// Represents the complete UI schema that defines inputs, outputs, and layout
    /// </summary>
    public class UISchema
    {
        [JsonProperty("id")]
        public string Id { get; set; }

        [JsonProperty("name")]
        public string Name { get; set; }

        [JsonProperty("description")]
        public string Description { get; set; }

        [JsonProperty("version")]
        public string Version { get; set; } = "1.0";

        [JsonProperty("created")]
        public DateTime Created { get; set; } = DateTime.UtcNow;

        [JsonProperty("inputs")]
        public List<InputParameter> Inputs { get; set; } = new List<InputParameter>();

        [JsonProperty("outputs")]
        public List<OutputParameter> Outputs { get; set; } = new List<OutputParameter>();

        [JsonProperty("layout")]
        public LayoutConfig Layout { get; set; } = new LayoutConfig();
        
        [JsonProperty("enable3dViewer")]
        public bool Enable3dViewer { get; set; } = false;
    }

    /// <summary>
    /// Represents an input parameter in the UI
    /// </summary>
    public class InputParameter
    {
        [JsonProperty("grasshopperId")]
        public Guid GrasshopperId { get; set; } // The component instance GUID in Grasshopper

        [JsonProperty("name")]
        public string Name { get; set; }

        [JsonProperty("nickname")]
        public string Nickname { get; set; }

        [JsonProperty("type")]
        public string Type { get; set; } // "number", "slider", "dropdown", "text", "checkbox", "color"

        [JsonProperty("default")]
        public object Default { get; set; }

        [JsonProperty("grasshopperParamName")]
        public string GrasshopperParamName { get; set; }

        // Compute-style metadata
        [JsonProperty("description")]
        public string Description { get; set; }

        [JsonProperty("paramType")]
        public string ParamType { get; set; } // The Grasshopper parameter type (Number, Text, Boolean, Point, Geometry, etc.)

        [JsonProperty("atLeast")]
        public int AtLeast { get; set; } = 1;

        [JsonProperty("atMost")]
        public int AtMost { get; set; } = int.MaxValue;

        [JsonProperty("treeAccess")]
        public bool TreeAccess { get; set; } = false;

        [JsonProperty("minimum")]
        public object Minimum { get; set; }

        [JsonProperty("maximum")]
        public object Maximum { get; set; }

        // UI Builder metadata
        [JsonProperty("groupName")]
        public string GroupName { get; set; } // Group this parameter belongs to (e.g., "Geometry", "Settings")

        [JsonProperty("displayName")]
        public string DisplayName { get; set; } // Alternative display name for the UI

        [JsonProperty("order")]
        public int Order { get; set; } // Display order within the group

        [JsonProperty("tooltip")]
        public string Tooltip { get; set; } // Additional help text

        [JsonProperty("config")]
        public InputConfig Config { get; set; } = new InputConfig();
    }

    /// <summary>
    /// Configuration for input parameters
    /// </summary>
    public class InputConfig
    {
        [JsonProperty("min")]
        public double? Min { get; set; }

        [JsonProperty("max")]
        public double? Max { get; set; }

        [JsonProperty("step")]
        public double? Step { get; set; }

        [JsonProperty("options")]
        public List<string> Options { get; set; } // For dropdowns

        [JsonProperty("placeholder")]
        public string Placeholder { get; set; }

        [JsonProperty("required")]
        public bool Required { get; set; }
    }

    /// <summary>
    /// Represents an output parameter in the UI
    /// </summary>
    public class OutputParameter
    {
        [JsonProperty("grasshopperId")]
        public Guid GrasshopperId { get; set; }

        [JsonProperty("name")]
        public string Name { get; set; }

        [JsonProperty("nickname")]
        public string Nickname { get; set; }

        [JsonProperty("type")]
        public string Type { get; set; } // "text", "number", "3d-viewer", "chart"

        [JsonProperty("grasshopperParamName")]
        public string GrasshopperParamName { get; set; }

        // Compute-style metadata
        [JsonProperty("paramType")]
        public string ParamType { get; set; } // The Grasshopper parameter type

        // UI Builder metadata
        [JsonProperty("groupName")]
        public string GroupName { get; set; } // Group this output belongs to

        [JsonProperty("displayName")]
        public string DisplayName { get; set; } // Alternative display name for the UI

        [JsonProperty("order")]
        public int Order { get; set; } // Display order within the group

        [JsonProperty("description")]
        public string Description { get; set; }

        [JsonProperty("config")]
        public OutputConfig Config { get; set; } = new OutputConfig();
    }

    /// <summary>
    /// Configuration for output parameters
    /// </summary>
    public class OutputConfig
    {
        [JsonProperty("format")]
        public string Format { get; set; } // For number formatting

        [JsonProperty("unit")]
        public string Unit { get; set; }

        [JsonProperty("chartType")]
        public string ChartType { get; set; } // "line", "bar", "pie"
    }

    /// <summary>
    /// Layout configuration for the UI with tabs and groups
    /// </summary>
    public class LayoutConfig
    {
        [JsonProperty("type")]
        public string Type { get; set; } = "tabbed"; // "grid", "flex", "tabbed"

        [JsonProperty("columns")]
        public int Columns { get; set; } = 12;

        [JsonProperty("gap")]
        public int Gap { get; set; } = 16;

        [JsonProperty("tabs")]
        public List<TabConfig> Tabs { get; set; } = new List<TabConfig>();

        [JsonProperty("items")]
        public List<LayoutItem> Items { get; set; } = new List<LayoutItem>(); // Legacy grid layout
    }

    /// <summary>
    /// Tab container for organizing UI sections
    /// </summary>
    public class TabConfig
    {
        [JsonProperty("id")]
        public string Id { get; set; }

        [JsonProperty("label")]
        public string Label { get; set; }

        [JsonProperty("icon")]
        public string Icon { get; set; } // Optional icon/emoji

        [JsonProperty("order")]
        public int Order { get; set; } = 0;

        [JsonProperty("groups")]
        public List<GroupConfig> Groups { get; set; } = new List<GroupConfig>();
    }

    /// <summary>
    /// Group container for related parameters within a tab
    /// </summary>
    public class GroupConfig
    {
        [JsonProperty("id")]
        public string Id { get; set; }

        [JsonProperty("label")]
        public string Label { get; set; }

        [JsonProperty("description")]
        public string Description { get; set; }

        [JsonProperty("order")]
        public int Order { get; set; } = 0;

        [JsonProperty("collapsed")]
        public bool Collapsed { get; set; } = false;

        [JsonProperty("columns")]
        public int Columns { get; set; } = 1; // Layout columns within group

        [JsonProperty("items")]
        public List<GroupItem> Items { get; set; } = new List<GroupItem>();
    }

    /// <summary>
    /// Item within a group (input or output parameter)
    /// </summary>
    public class GroupItem
    {
        [JsonProperty("id")]
        public string Id { get; set; } // Unique item ID

        [JsonProperty("parameterId")]
        public string ParameterId { get; set; } // References input/output ID

        [JsonProperty("type")]
        public string Type { get; set; } // "input" or "output"

        [JsonProperty("displayName")]
        public string DisplayName { get; set; } // Override display name

        [JsonProperty("order")]
        public int Order { get; set; } = 0;

        [JsonProperty("span")]
        public int Span { get; set; } = 1; // Column span within group
    }

    /// <summary>
    /// Individual layout item positioning (legacy grid layout)
    /// </summary>
    public class LayoutItem
    {
        [JsonProperty("id")]
        public string Id { get; set; } // References input/output ID

        [JsonProperty("row")]
        public int Row { get; set; }

        [JsonProperty("column")]
        public int Column { get; set; }

        [JsonProperty("width")]
        public int Width { get; set; } = 1;

        [JsonProperty("height")]
        public int Height { get; set; } = 1;
    }

    /// <summary>
    /// Runtime values for inputs
    /// </summary>
    public class RuntimeValues
    {
        [JsonProperty("timestamp")]
        public DateTime Timestamp { get; set; } = DateTime.UtcNow;

        [JsonProperty("values")]
        public Dictionary<string, object> Values { get; set; } = new Dictionary<string, object>();
    }

    /// <summary>
    /// Session state information
    /// </summary>
    public class SessionState
    {
        [JsonProperty("sessionId")]
        public string SessionId { get; set; }

        [JsonProperty("active")]
        public bool Active { get; set; }

        [JsonProperty("lastUpdate")]
        public DateTime LastUpdate { get; set; } = DateTime.UtcNow;

        [JsonProperty("mode")]
        public string Mode { get; set; } // "builder" or "preview"
    }

    /// <summary>
    /// Represents an available parameter that can be added to the schema
    /// </summary>
    public class AvailableParameter
    {
        [JsonProperty("id")]
        public Guid Id { get; set; }

        [JsonProperty("name")]
        public string Name { get; set; }

        [JsonProperty("nickname")]
        public string Nickname { get; set; }

        [JsonProperty("description")]
        public string Description { get; set; }

        [JsonProperty("category")]
        public string Category { get; set; } // "input" or "output"

        [JsonProperty("paramType")]
        public string ParamType { get; set; } // Grasshopper parameter type (Number, Text, Boolean, Point, Geometry, etc.)

        [JsonProperty("default")]
        public object Default { get; set; }

        [JsonProperty("minimum")]
        public object Minimum { get; set; } = null;

        [JsonProperty("maximum")]
        public object Maximum { get; set; } = null;

        [JsonProperty("atLeast")]
        public int AtLeast { get; set; } = 1;

        [JsonProperty("atMost")]
        public int AtMost { get; set; } = int.MaxValue;

        [JsonProperty("treeAccess")]
        public bool TreeAccess { get; set; } = false;
    }

    /// <summary>
    /// Available parameters in the Grasshopper document
    /// </summary>
    public class AvailableParameters
    {
        [JsonProperty("sessionId")]
        public string SessionId { get; set; }

        [JsonProperty("timestamp")]
        public DateTime Timestamp { get; set; } = DateTime.UtcNow;

        [JsonProperty("parameters")]
        public List<AvailableParameter> Parameters { get; set; } = new List<AvailableParameter>();
    }

    
}


