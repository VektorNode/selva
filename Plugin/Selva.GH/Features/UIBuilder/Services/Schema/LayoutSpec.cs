using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Selva.Schema.Models;
using Selva.Schema.Services.Validation;

namespace Selva.GH.Features.UIBuilder.Services.Schema;

/// <summary>
///     The form layout addressed by parameter nickname instead of GUID, so a script or an agent can
///     lay out a definition without knowing ids. The spec is the whole layout: what it leaves out is
///     dropped. Tabs, groups and items that survive keep their ids, and an item keeps every field
///     the spec does not give, so applying what <see cref="Read" /> returns changes nothing but each
///     <c>order</c>, which follows the array. Rhino-free; <see cref="SchemaLayout" /> runs it on a
///     live definition.
/// </summary>
public static class LayoutSpec
{
    public sealed class Outcome
    {
        /// <summary>The laid-out copy; null when <see cref="Errors" /> has any.</summary>
        public UISchema Schema { get; internal set; }

        public List<string> Errors { get; } = new List<string>();

        /// <summary>Inputs and outputs no item shows, by nickname.</summary>
        public List<string> Unplaced { get; } = new List<string>();
    }

    private static readonly JsonSerializer Serializer = JsonSerializer.Create(SchemaSerializationSettings.Settings);

    private static readonly string[] RootKeys = { "name", "description", "tabs", "groups", "unplaced" };
    private static readonly string[] TabKeys = { "id", "label", "icon", "position", "visible", "groups" };

    private static readonly string[] GroupKeys =
        { "id", "label", "description", "collapsed", "columns", "visibilityCondition", "items" };

    private static readonly string[] ItemKeys =
    {
        "param", "paramId", "widget", "label", "description", "config", "source", "default", "span", "visible",
        "visibilityCondition"
    };

    // ============================================================================
    // Read
    // ============================================================================

    public static JObject Read(UISchema schema)
    {
        var parameters = Parameters.Of(schema);
        var spec = new JObject();
        if (!string.IsNullOrEmpty(schema.Name))
        {
            spec["name"] = schema.Name;
        }

        if (!string.IsNullOrEmpty(schema.Description))
        {
            spec["description"] = schema.Description;
        }

        switch (schema.Layout)
        {
            case TabbedLayoutConfig tabbed:
                spec["tabs"] = new JArray(tabbed.Tabs.Select(t => ReadTab(t, parameters)));
                break;
            case FlatLayoutConfig flat:
                spec["groups"] = new JArray(flat.Groups.Select(g => ReadGroup(g, parameters)));
                break;
        }

        var placed = new HashSet<Guid>(SchemaOutputCanonicalizer.GetAllLayoutItems(schema.Layout).Select(i => i.ParamId));
        var unplaced = parameters.All.Where(p => !placed.Contains(p.Id)).ToList();
        if (unplaced.Count > 0)
        {
            spec["unplaced"] = new JArray(unplaced.Select(p => new JObject
            {
                ["param"] = p.Nickname,
                [p.IsOutput ? "output" : "input"] = p.Type
            }));
        }

        return spec;
    }

    private static JObject ReadTab(TabConfig tab, Parameters parameters)
    {
        var spec = new JObject { ["label"] = tab.Label };
        if (!string.IsNullOrEmpty(tab.Icon))
        {
            spec["icon"] = tab.Icon;
        }

        if (tab.Position != null && tab.Position != "center")
        {
            spec["position"] = tab.Position;
        }

        if (tab.Visible == false)
        {
            spec["visible"] = false;
        }

        spec["groups"] = new JArray(tab.Groups.Select(g => ReadGroup(g, parameters)));
        return spec;
    }

    private static JObject ReadGroup(GroupConfig group, Parameters parameters)
    {
        var spec = new JObject { ["label"] = group.Label };
        if (!string.IsNullOrEmpty(group.Description))
        {
            spec["description"] = group.Description;
        }

        if (group.Collapsed == true)
        {
            spec["collapsed"] = true;
        }

        if (group.Columns is int columns && columns != 1)
        {
            spec["columns"] = columns;
        }

        if (group.VisibilityCondition != null)
        {
            spec["visibilityCondition"] = ReadCondition(JObject.FromObject(group.VisibilityCondition, Serializer), parameters);
        }

        spec["items"] = new JArray(group.Items.Select(i => ReadItem(i, parameters)));
        return spec;
    }

    private static JToken ReadItem(LayoutItemBase item, Parameters parameters)
    {
        if (item is LineBreakLayoutItem)
        {
            return new JObject { ["linebreak"] = true };
        }

        var raw = JObject.FromObject(item, Serializer);
        var name = parameters.NicknameOf(item.ParamId);
        var spec = name != null
            ? new JObject { ["param"] = name }
            : new JObject { ["paramId"] = item.ParamId.ToString() };
        spec["widget"] = item.WidgetType;
        if (!string.IsNullOrEmpty(item.DisplayName) && item.DisplayName != name)
        {
            spec["label"] = item.DisplayName;
        }

        if (!string.IsNullOrEmpty(item.Description))
        {
            spec["description"] = item.Description;
        }

        foreach (var key in new[] { "config", "source" })
        {
            if (raw[key] is JObject value && value.HasValues)
            {
                spec[key] = value;
            }
        }

        if (item.Span is int span && span != 1)
        {
            spec["span"] = span;
        }

        if (item.Visible == false)
        {
            spec["visible"] = false;
        }

        if (raw["visibilityCondition"] is JObject condition)
        {
            spec["visibilityCondition"] = ReadCondition(condition, parameters);
        }

        return spec;
    }

    private static JObject ReadCondition(JObject condition, Parameters parameters)
    {
        var copy = (JObject)condition.DeepClone();
        foreach (var rule in (copy["rules"] as JArray ?? new JArray()).OfType<JObject>())
        {
            if (Guid.TryParse((string)rule["paramId"], out var id) && parameters.NicknameOf(id) is { } name)
            {
                rule.Remove("paramId");
                rule.AddFirst(new JProperty("param", name));
            }
        }

        return copy;
    }

    // ============================================================================
    // Apply
    // ============================================================================

    /// <param name="canvasConfig">
    ///     Config for a new item whose spec gives none, from the canvas (a value list's options, a
    ///     getter's range). Takes the param id and widget; null leaves the item without one.
    /// </param>
    public static Outcome Apply(UISchema current, JObject spec, Func<Guid, string, JObject> canvasConfig = null)
    {
        var outcome = new Outcome();
        var schema = Clone(current);
        var build = new Builder(schema, canvasConfig, outcome.Errors);

        build.RejectUnknownKeys(spec, RootKeys, "the spec");
        var tabs = spec["tabs"] as JArray;
        var groups = spec["groups"] as JArray;
        if ((tabs == null) == (groups == null))
        {
            outcome.Errors.Add("Give \"tabs\" (a tabbed form) or \"groups\" (a single page), not both or neither.");
            return outcome;
        }

        LayoutConfigBase layout = tabs != null
            ? new TabbedLayoutConfig { Tabs = tabs.Select((t, i) => build.Tab(t, i)).ToList() }
            : new FlatLayoutConfig { Groups = groups.Select((g, i) => build.Group(g, i, null, "")).ToList() };
        layout.Gap = schema.Layout?.Gap ?? layout.Gap;

        if (outcome.Errors.Count > 0)
        {
            return outcome;
        }

        schema.Layout = layout;
        if (spec["name"]?.Type == JTokenType.String)
        {
            schema.Name = (string)spec["name"];
        }

        if (spec["description"]?.Type == JTokenType.String)
        {
            schema.Description = (string)spec["description"];
        }

        var before = new HashSet<string>(ValidationErrors(current));
        outcome.Errors.AddRange(ValidationErrors(schema).Where(e => !before.Contains(e)));
        if (outcome.Errors.Count > 0)
        {
            return outcome;
        }

        outcome.Unplaced.AddRange(build.Parameters.All.Where(p => !build.Placed.Contains(p.Id)).Select(p => p.Nickname));
        outcome.Schema = schema;
        return outcome;
    }

    internal static UISchema Clone(UISchema schema)
    {
        return JsonConvert.DeserializeObject<UISchema>(
            JsonConvert.SerializeObject(schema, SchemaSerializationSettings.Settings),
            SchemaSerializationSettings.Settings);
    }

    private static IEnumerable<string> ValidationErrors(UISchema schema)
    {
        return new SchemaValidator().Validate(schema).Issues
            .Where(i => i.Severity == ValidationSeverity.Error)
            .Select(i => string.IsNullOrEmpty(i.Details) ? i.Message : $"{i.Message} ({i.Details})");
    }

    private sealed class Builder
    {
        private readonly Func<Guid, string, JObject> _canvasConfig;
        private readonly List<string> _errors;
        private readonly Dictionary<Guid, LayoutItemBase> _oldItems;
        private readonly List<(string Tab, GroupConfig Group)> _oldGroups;
        private readonly List<TabConfig> _oldTabs;
        private readonly UISchema _schema;
        private readonly HashSet<string> _tabIds = new HashSet<string>();
        private readonly HashSet<string> _groupIds = new HashSet<string>();
        private readonly HashSet<string> _itemIds = new HashSet<string>();

        // Ids the old layout holds: a new tab, group or item never takes one a later one may keep.
        private readonly HashSet<string> _reserved;

        public Builder(UISchema schema, Func<Guid, string, JObject> canvasConfig, List<string> errors)
        {
            _schema = schema;
            _canvasConfig = canvasConfig;
            _errors = errors;
            Parameters = Parameters.Of(schema);
            _oldItems = SchemaOutputCanonicalizer.GetAllLayoutItems(schema.Layout)
                .Where(i => i is not LineBreakLayoutItem)
                .GroupBy(i => i.ParamId)
                .ToDictionary(g => g.Key, g => g.First());
            _oldTabs = (schema.Layout as TabbedLayoutConfig)?.Tabs ?? new List<TabConfig>();
            _oldGroups = _oldTabs.SelectMany(t => t.Groups.Select(g => (t.Label, g)))
                .Concat(((schema.Layout as FlatLayoutConfig)?.Groups ?? new List<GroupConfig>()).Select(g => ((string)null, g)))
                .ToList();
            _reserved = new HashSet<string>(_oldTabs.Select(t => t.Id)
                .Concat(_oldGroups.Select(x => x.Group.Id))
                .Concat(_oldItems.Values.Select(i => i.Id))
                .Where(id => id != null));
        }

        public Parameters Parameters { get; }

        public HashSet<Guid> Placed { get; } = new HashSet<Guid>();

        public TabConfig Tab(JToken token, int index)
        {
            var where = $"tabs[{index}]";
            if (token is not JObject spec || !(Text(spec, "label") is { Length: > 0 } label))
            {
                _errors.Add($"{where}: a tab is an object with a \"label\".");
                return new TabConfig();
            }

            where = $"tab \"{label}\"";
            RejectUnknownKeys(spec, TabKeys, where);
            var old = _oldTabs.FirstOrDefault(t => t.Label == label && !_tabIds.Contains(t.Id));
            var tab = new TabConfig
            {
                Id = Claim(_tabIds, Text(spec, "id") ?? old?.Id, "tab-" + Slug(label), where),
                Label = label,
                Icon = Has(spec, "icon") ? Text(spec, "icon") : old?.Icon,
                Order = index,
                Position = Text(spec, "position") ?? old?.Position ?? "center",
                Visible = (bool?)spec["visible"] ?? old?.Visible ?? true
            };
            var groups = spec["groups"] as JArray;
            if (groups == null)
            {
                _errors.Add($"{where}: \"groups\" must be an array.");
                return tab;
            }

            tab.Groups = groups.Select((g, i) => Group(g, i, label, where + " ")).ToList();
            return tab;
        }

        public GroupConfig Group(JToken token, int index, string tabLabel, string within)
        {
            var where = $"{within}groups[{index}]";
            if (token is not JObject spec || !(Text(spec, "label") is { Length: > 0 } label))
            {
                _errors.Add($"{where}: a group is an object with a \"label\".");
                return new GroupConfig();
            }

            where = $"{within}group \"{label}\"";
            RejectUnknownKeys(spec, GroupKeys, where);
            var old = _oldGroups.Where(x => x.Group.Label == label && !_groupIds.Contains(x.Group.Id))
                .OrderBy(x => x.Tab == tabLabel ? 0 : 1)
                .Select(x => x.Group)
                .FirstOrDefault();
            var fallback = !IsFree("grp-" + Slug(label)) && tabLabel != null
                ? $"grp-{Slug(tabLabel)}-{Slug(label)}"
                : "grp-" + Slug(label);
            var group = new GroupConfig
            {
                Id = Claim(_groupIds, Text(spec, "id") ?? old?.Id, fallback, where),
                Label = label,
                Description = Has(spec, "description") ? Text(spec, "description") : old?.Description,
                Order = index,
                Collapsed = (bool?)spec["collapsed"] ?? old?.Collapsed ?? false,
                Columns = (int?)spec["columns"] ?? old?.Columns ?? 1,
                VisibilityCondition = Has(spec, "visibilityCondition")
                    ? Condition(spec["visibilityCondition"], where)?.ToObject<GroupVisibilityCondition>(Serializer)
                    : old?.VisibilityCondition
            };
            var items = spec["items"] as JArray;
            if (items == null)
            {
                _errors.Add($"{where}: \"items\" must be an array.");
                return group;
            }

            group.Items = items.Select((item, i) => Item(item, i, group.Id, $"{where} items[{i}]"))
                .Where(item => item != null)
                .ToList();
            return group;
        }

        private LayoutItemBase Item(JToken token, int index, string groupId, string where)
        {
            var spec = token.Type == JTokenType.String ? new JObject { ["param"] = token } : token as JObject;
            if (spec == null)
            {
                _errors.Add($"{where}: an item is a nickname or an object.");
                return null;
            }

            if (spec["linebreak"] != null)
            {
                RejectUnknownKeys(spec, new[] { "linebreak" }, where);
                return new LineBreakLayoutItem { Id = $"br-{groupId}-{index}" };
            }

            RejectUnknownKeys(spec, ItemKeys, where);
            var param = Resolve(spec, where);
            if (param == null)
            {
                return null;
            }

            where = $"\"{param.Nickname}\"";
            if (!Placed.Add(param.Id))
            {
                _errors.Add($"{where} is placed twice.");
                return null;
            }

            _oldItems.TryGetValue(param.Id, out var old);
            var oldRaw = old == null ? null : JObject.FromObject(old, Serializer);
            var type = param.IsOutput ? "output" : "input";
            var widget = Text(spec, "widget") ?? (old?.Type == type ? old.WidgetType : null) ?? DefaultWidget(param);
            if (widget == null)
            {
                _errors.Add($"{where}: say which \"widget\" shows a {param.Type} {type}.");
                return null;
            }

            var keepsWidget = old != null && old.Type == type && old.WidgetType == widget;
            var config = (keepsWidget ? oldRaw["config"] as JObject : null) ?? _canvasConfig?.Invoke(param.Id, widget);
            if (spec["config"] is JObject change)
            {
                config = (JObject)config?.DeepClone() ?? new JObject();
                config.Merge(change, new JsonMergeSettings { MergeArrayHandling = MergeArrayHandling.Replace });
            }

            var raw = new JObject
            {
                ["type"] = type,
                ["widgetType"] = widget,
                ["id"] = old?.Id ?? Claim(_itemIds, null, "item-" + Slug(param.Nickname), where),
                ["paramId"] = param.Id.ToString(),
                ["displayName"] = Value(Pick(spec, "label", oldRaw, "displayName")) ?? param.Nickname,
                ["order"] = index
            };
            _itemIds.Add((string)raw["id"]);
            Put(raw, "description", Value(Pick(spec, "description", oldRaw, "description"))
                                    ?? (string.IsNullOrEmpty(param.Description) ? null : param.Description));
            Put(raw, "config", config);
            Put(raw, "source", Pick(spec, "source", oldRaw, "source"));
            Put(raw, "span", Pick(spec, "span", oldRaw, "span"));
            Put(raw, "visible", Pick(spec, "visible", oldRaw, "visible"));
            Put(raw, "visibilityCondition", Has(spec, "visibilityCondition")
                ? Condition(spec["visibilityCondition"], where)
                : oldRaw?["visibilityCondition"]);

            var item = raw.ToObject<LayoutItemBase>(Serializer);
            if (item is UnknownLayoutItem)
            {
                _errors.Add($"{where}: there is no \"{widget}\" widget for an {type}.");
                return null;
            }

            if (Has(spec, "description"))
            {
                param.SetDescription(_schema, Text(spec, "description"));
            }

            if (Has(spec, "default") && !param.IsOutput)
            {
                _schema.Inputs.First(i => i.Id == param.Id).Default = spec["default"].ToObject<object>();
            }

            return item;
        }

        private Parameter Resolve(JObject spec, string where)
        {
            if (Text(spec, "paramId") is { } text)
            {
                var byId = Guid.TryParse(text, out var id) ? Parameters.All.FirstOrDefault(p => p.Id == id) : null;
                if (byId == null)
                {
                    _errors.Add($"{where}: no input or output has id {text}.");
                }

                return byId;
            }

            if (!(Text(spec, "param") is { Length: > 0 } name))
            {
                _errors.Add($"{where}: an item needs \"param\" (a nickname) or \"paramId\".");
                return null;
            }

            var found = Parameters.Named(name);
            if (found.Count == 1)
            {
                return found[0];
            }

            _errors.Add(found.Count == 0
                ? $"{where}: nothing on the canvas is named \"{name}\"."
                : $"{where}: {found.Count} parameters are named \"{name}\"; give \"paramId\" instead.");
            return null;
        }

        private JToken Condition(JToken token, string where)
        {
            if (token is not JObject condition)
            {
                return null;
            }

            var copy = (JObject)condition.DeepClone();
            foreach (var rule in (copy["rules"] as JArray ?? new JArray()).OfType<JObject>())
            {
                if (rule["param"] == null)
                {
                    continue;
                }

                var param = Resolve(new JObject { ["param"] = rule["param"] }, where + " visibilityCondition");
                rule.Remove("param");
                rule["paramId"] = param?.Id.ToString() ?? "";
            }

            return copy;
        }

        private string Claim(HashSet<string> taken, string wanted, string fallback, string where)
        {
            if (wanted != null)
            {
                if (!taken.Add(wanted))
                {
                    _errors.Add($"{where}: id \"{wanted}\" is used twice.");
                }

                return wanted;
            }

            var id = fallback;
            for (var n = 2; !IsFree(id); n++)
            {
                id = $"{fallback}-{n}";
            }

            taken.Add(id);
            return id;
        }

        private bool IsFree(string id)
        {
            return !_reserved.Contains(id) && !_tabIds.Contains(id) && !_groupIds.Contains(id) && !_itemIds.Contains(id);
        }

        public void RejectUnknownKeys(JObject spec, string[] allowed, string where)
        {
            foreach (var property in spec.Properties().Where(p => !allowed.Contains(p.Name)))
            {
                _errors.Add($"{where}: unknown key \"{property.Name}\". Known: {string.Join(", ", allowed)}.");
            }
        }
    }

    private static string DefaultWidget(Parameter param)
    {
        if (param.IsOutput)
        {
            return param.Type switch
            {
                "file" or "chart" or "dynamicValueList" or "number" => param.Type,
                _ => "text"
            };
        }

        return param.Type switch
        {
            "number" or "integer" => "number",
            "boolean" => "checkbox",
            "valueList" => "dropdown",
            "dynamicValueList" or "file" or "color" or "text" => param.Type,
            "generic" => "text",
            _ => null
        };
    }

    private static bool Has(JObject spec, string key)
    {
        return spec.ContainsKey(key);
    }

    private static string Text(JObject spec, string key)
    {
        return spec[key]?.Type == JTokenType.String ? (string)spec[key] : null;
    }

    /// <summary>The spec's value when it gives the key (null clears it), else the old item's.</summary>
    private static JToken Pick(JObject spec, string key, JObject old, string oldKey)
    {
        return spec.ContainsKey(key) ? spec[key] : old?[oldKey];
    }

    private static JToken Value(JToken token)
    {
        return token == null || token.Type == JTokenType.Null ? null : token;
    }

    private static void Put(JObject target, string key, JToken value)
    {
        if (value != null && value.Type != JTokenType.Null)
        {
            target[key] = value.DeepClone();
        }
    }

    private static string Slug(string label)
    {
        var plain = new StringBuilder();
        foreach (var ch in label.Normalize(NormalizationForm.FormD).ToLowerInvariant())
        {
            if (CharUnicodeInfo.GetUnicodeCategory(ch) == UnicodeCategory.NonSpacingMark)
            {
                continue;
            }

            plain.Append(ch < 128 && char.IsLetterOrDigit(ch) ? ch : '-');
        }

        var slug = string.Join("-", plain.ToString().Split(new[] { '-' }, StringSplitOptions.RemoveEmptyEntries));
        return slug.Length > 0 ? slug : "x";
    }

    // ============================================================================
    // Parameters
    // ============================================================================

    private sealed class Parameter
    {
        public Guid Id { get; set; }
        public string Nickname { get; set; }
        public bool IsOutput { get; set; }
        public string Type { get; set; }
        public string Description { get; set; }

        public void SetDescription(UISchema schema, string description)
        {
            if (IsOutput)
            {
                schema.Outputs.First(o => o.Id == Id).Description = description;
            }
            else
            {
                schema.Inputs.First(i => i.Id == Id).Description = description;
            }
        }
    }

    private sealed class Parameters
    {
        private Parameters(List<Parameter> all)
        {
            All = all;
        }

        public List<Parameter> All { get; }

        public static Parameters Of(UISchema schema)
        {
            return new Parameters(schema.Inputs
                .Select(i => new Parameter
                    { Id = i.Id, Nickname = i.Nickname, Type = i.ParamType, Description = i.Description })
                .Concat(schema.Outputs.Select(o => new Parameter
                    { Id = o.Id, Nickname = o.Nickname, IsOutput = true, Type = o.Type, Description = o.Description }))
                .ToList());
        }

        public string NicknameOf(Guid id)
        {
            var named = All.Where(p => p.Id == id).Select(p => p.Nickname).FirstOrDefault();
            return named != null && Named(named).Count == 1 ? named : null;
        }

        /// <summary>Exact matches first; a case-insensitive match only when there is no exact one.</summary>
        public List<Parameter> Named(string nickname)
        {
            var exact = All.Where(p => p.Nickname == nickname).ToList();
            return exact.Count > 0
                ? exact
                : All.Where(p => string.Equals(p.Nickname, nickname, StringComparison.OrdinalIgnoreCase)).ToList();
        }
    }
}
