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
        public List<InputParamSchema> Inputs { get; set; } = new List<InputParamSchema>();

        [JsonProperty("outputs")]
        public List<OutputParamSchema> Outputs { get; set; } = new List<OutputParamSchema>();

        [JsonProperty("layout")]
        public LayoutConfig Layout { get; set; } = new LayoutConfig();

        /// <summary>
        /// Indicates whether the 3D viewer sould be generated for the compute UI
        /// </summary>
        [JsonProperty("enable3dViewer")]
        public bool Enable3dViewer { get; set; } = false;
    }

    // ============================================================================
    // CORE PARAMETER SCHEMAS (Compute-compatible)
    // ============================================================================

    /// <summary>
    /// Base parameter schema - tracked by Grasshopper instance GUID
    /// </summary>
    public class IoParamSchema
    {
        /// <summary>
        /// Grasshopper component instance GUID - stable reference across document saves
        /// </summary>
        [JsonProperty("id")]
        public Guid Id { get; set; }

        [JsonProperty("name")]
        public string Name { get; set; }

        [JsonProperty("nickname")]
        public string Nickname { get; set; }

        [JsonProperty("paramType")]
        public string ParamType { get; set; } // "Number", "Point", "Geometry", etc.
    }

    /// <summary>
    /// Input parameter schema - matches Rhino Compute input format
    /// </summary>
    public class InputParamSchema : IoParamSchema
    {
        [JsonProperty("description")]
        public string Description { get; set; }

        [JsonProperty("atLeast")]
        public int AtLeast { get; set; } = 1;

        [JsonProperty("atMost")]
        public int AtMost { get; set; } = int.MaxValue;

        [JsonProperty("treeAccess")]
        public bool TreeAccess { get; set; } = false;

        /// <summary>
        /// Default value - NOT persisted in schema files (loaded from AvailableParameters)
        /// This field exists for backwards compatibility but should remain null in saved schemas
        /// </summary>
        [JsonProperty("default", NullValueHandling = NullValueHandling.Ignore)]
        public object Default { get; set; } = null;

        [JsonProperty("minimum")]
        public object Minimum { get; set; } = null;

        [JsonProperty("maximum")]
        public object Maximum { get; set; } = null;

        [JsonProperty("stepSize")]
        public double? StepSize { get; set; } = null;
    }

    /// <summary>
    /// Output parameter schema
    /// </summary>
    public class OutputParamSchema : IoParamSchema
    {
        [JsonProperty("description")]
        public string Description { get; set; }
    }

    // ============================================================================
    // UI LAYOUT SCHEMA (ComputeBuilder-specific)
    // ============================================================================

    /// <summary>
    /// Layout item referencing a parameter with UI-specific configuration
    /// </summary>
    public class LayoutItem
    {
        /// <summary>
        /// Unique layout item ID (generated for each layout placement)
        /// </summary>
        [JsonProperty("id")]
        public string Id { get; set; }

        /// <summary>
        /// References the Grasshopper component InstanceGuid (from InputParamSchema.Id or OutputParamSchema.Id)
        /// </summary>
        [JsonProperty("paramId")]
        public Guid ParamId { get; set; }

        [JsonProperty("type")]
        public string Type { get; set; } // "input" or "output"

        /// <summary>
        /// Override display name (optional - if null, uses parameter's nickname or name)
        /// </summary>
        [JsonProperty("displayName")]
        public string DisplayName { get; set; }

        /// <summary>
        /// Widget type for rendering this parameter
        /// Inputs: "slider", "number", "text", "dropdown", "checkbox", "color"
        /// Outputs: "text", "number", "3d-viewer", "chart"
        /// </summary>
        [JsonProperty("widgetType")]
        public string WidgetType { get; set; }

        [JsonProperty("order")]
        public int Order { get; set; } = 0;

        [JsonProperty("span")]
        public int Span { get; set; } = 1;

        [JsonProperty("config")]
        public WidgetConfig Config { get; set; } = new WidgetConfig();
    }

    /// <summary>
    /// Widget-specific configuration (consolidated from InputConfig/OutputConfig)
    /// </summary>
    public class WidgetConfig
    {
        // Number/slider widgets
        [JsonProperty("min")]
        public double? Min { get; set; }

        [JsonProperty("max")]
        public double? Max { get; set; }

        [JsonProperty("step")]
        public double? Step { get; set; }

        // Dropdown widgets
        [JsonProperty("options")]
        public List<string> Options { get; set; }

        // Text input widgets
        [JsonProperty("placeholder")]
        public string Placeholder { get; set; }

        [JsonProperty("required")]
        public bool Required { get; set; }

        // Output display widgets
        [JsonProperty("format")]
        public string Format { get; set; }

        [JsonProperty("unit")]
        public string Unit { get; set; }
    }

    /// <summary>
    /// Layout configuration for the UI
    /// </summary>
    public class LayoutConfig
    {
        /// <summary>
        /// Layout type:
        /// - "tabbed": Multi-tab interface with groups
        /// - "flat": Simple single-column list of all parameters
        /// </summary>
        [JsonProperty("type")]
        public string Type { get; set; } = "tabbed";

        [JsonProperty("gap")]
        public int Gap { get; set; } = 16;

        // For "tabbed" layout
        [JsonProperty("tabs")]
        public List<TabConfig> Tabs { get; set; } = new List<TabConfig>();

        // For "flat" layout
        [JsonProperty("items")]
        public List<LayoutItem> Items { get; set; } = new List<LayoutItem>();
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
        public string Icon { get; set; }

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
        public List<LayoutItem> Items { get; set; } = new List<LayoutItem>();
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
        public string Mode { get; set; }
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
        public string Category { get; set; }

        [JsonProperty("paramType")]
        public string ParamType { get; set; }

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
        
        [JsonProperty("stepSize")]
        public decimal? StepSize { get; set; } = null;
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


