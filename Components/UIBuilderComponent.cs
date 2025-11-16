using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using Grasshopper.Kernel;
using Grasshopper.Kernel.Parameters;
using Grasshopper.Kernel.Types;
using ComputeBuilder.Utils;
using ComputeBuilder.Models;
using Newtonsoft.Json;

namespace ComputeBuilder.Components
{
    /// <summary>
    /// Unified UI Builder component
    /// Switch between Schema Builder mode and Interactive Preview mode
    /// </summary>
    public class UIBuilderComponent : GH_Component, IDisposable
    {
        private string _sessionId;
        private bool _previewOpen = false;
        private DateTime _lastValuesCheck = DateTime.MinValue;
        private Dictionary<string, object> _lastAppliedValues = new Dictionary<string, object>();
        private WebSocketServer _webSocketServer;
        private bool _useWebSocket = true;
        private const int WEBSOCKET_PORT = 8765;
        private bool _disposed = false;
        private GH_Document _currentDocument;
        private bool _eventsRegistered = false;
        private int _solutionEndCount = 0;
        private bool _solutionInProgress = false;
        private bool _pendingExpire = false;

        // Embedded schema - persists with the .gh file
        private UISchema _embeddedSchema = null;
        private DateTime _lastSchemaSync = DateTime.MinValue;

        // Embedded values - persists parameter values with the .gh file
        private Dictionary<string, object> _embeddedValues = null;

        public UIBuilderComponent()
            : base("UI Builder", "UIBuilder",
                "Build and interact with your UI - toggle between builder and preview modes",
                "ComputeBuilder", "Core")
        {
        }

        ~UIBuilderComponent()
        {
            Dispose(false);
        }

        public override Guid ComponentGuid => new Guid("D4E5F6A7-B8C9-4D5E-0F1A-2B3C4D5E6F7A");

        protected override void RegisterInputParams(GH_InputParamManager pManager)
        {
            pManager.AddBooleanParameter("Enable", "Enable", "Enable UI Builder (opens web interface)",
                GH_ParamAccess.item, false);
            pManager.AddBooleanParameter("Refresh", "Refresh", "Refresh available parameters from document",
                GH_ParamAccess.item, false);
        }

        protected override void RegisterOutputParams(GH_OutputParamManager pManager)
        {
            pManager.AddTextParameter("Session ID", "ID", "Session identifier", GH_ParamAccess.item);
            pManager.AddTextParameter("Info", "Info", "Status information", GH_ParamAccess.item);
            pManager.AddTextParameter("Schema", "Schema", "Current UI schema (JSON)", GH_ParamAccess.item);
        }


        protected override void SolveInstance(IGH_DataAccess DA)
        {
            bool enable = false;
            bool refresh = false;

            DA.GetData(0, ref enable);
            DA.GetData(1, ref refresh);

            // Generate or maintain session ID
            if (string.IsNullOrEmpty(_sessionId))
            {
                _sessionId = Guid.NewGuid().ToString().Substring(0, 8);
            }

            DA.SetData(0, _sessionId);

            // Get document
            var document = this.OnPingDocument();
            if (document == null)
            {
                AddRuntimeMessage(GH_RuntimeMessageLevel.Error, "Could not access Grasshopper document");
                DA.SetData(1, "ERROR: No document");
                return;
            }

            // Register document events for cleanup
            if (_currentDocument != document)
            {
                UnregisterDocumentEvents();
                _currentDocument = document;
                RegisterDocumentEvents();
            }

            // Always scan and save available parameters (on enable or refresh)
            if (enable || refresh)
            {
                ScanAndSaveParameters(document);
            }

            // === ENABLED ===
            if (enable)
            {
                // Start WebSocket server
                if (_useWebSocket)
                {
                    if (_webSocketServer == null || !_webSocketServer.IsRunning)
                    {
                        StartWebSocket();
                    }
                }

                // Load embedded schema to temp files on first enable
                if (_embeddedSchema != null && !_previewOpen)
                {
                    SessionManager.WriteJson(SessionManager.GetSchemaPath(_sessionId), _embeddedSchema);
                    _lastSchemaSync = DateTime.UtcNow;
                }

                // Load embedded values to temp files and apply to parameters on first enable
                if (_embeddedValues != null && !_previewOpen)
                {
                    // Write values to temp file for web UI
                    var runtimeValues = new RuntimeValues
                    {
                        Timestamp = DateTime.UtcNow,
                        Values = _embeddedValues
                    };
                    SessionManager.WriteJson(SessionManager.GetValuesPath(_sessionId), runtimeValues);

                    // Apply values immediately to Grasshopper parameters
                    if (_embeddedSchema != null)
                    {
                        int updatedCount = ApplyValuesToParameters(document, _embeddedSchema, _embeddedValues);
                        if (updatedCount > 0)
                        {
                            _lastAppliedValues = new Dictionary<string, object>(_embeddedValues);
                        }
                    }
                }

                // Update session state as active
                var sessionState = new SessionState
                {
                    SessionId = _sessionId,
                    Active = true,
                    Mode = "active", // Web app decides build vs interactive
                    LastUpdate = DateTime.UtcNow
                };
                SessionManager.WriteJson(SessionManager.GetStatePath(_sessionId), sessionState);

                // Open UI (only once)
                if (!_previewOpen)
                {
                    OpenUI();
                    _previewOpen = true;
                }

                // Initialize last check time on first enable to prevent applying stale values
                if (_lastValuesCheck == DateTime.MinValue)
                {
                    _lastValuesCheck = DateTime.UtcNow;
                }

                // Check if schema has been modified in the web UI
                var schemaPath = SessionManager.GetSchemaPath(_sessionId);
                if (SessionManager.HasBeenModified(schemaPath, _lastSchemaSync))
                {
                    var updatedSchema = SessionManager.ReadJson<UISchema>(schemaPath);
                    if (updatedSchema != null)
                    {
                        _embeddedSchema = updatedSchema;
                        _lastSchemaSync = DateTime.UtcNow;
                    }
                }

                // Check for updated values from the web UI
                var valuesPath = SessionManager.GetValuesPath(_sessionId);
                if (SessionManager.HasBeenModified(valuesPath, _lastValuesCheck))
                {
                    var currentSchema = _embeddedSchema ?? SessionManager.ReadJson<UISchema>(schemaPath);
                    if (currentSchema != null)
                    {
                        var runtimeValues = SessionManager.ReadJson<RuntimeValues>(valuesPath);
                        if (runtimeValues != null && runtimeValues.Values != null)
                        {
                            // Apply values to Grasshopper parameters
                            int updatedCount = ApplyValuesToParameters(document, currentSchema, runtimeValues.Values);

                            _lastAppliedValues = new Dictionary<string, object>(runtimeValues.Values);
                            _lastValuesCheck = DateTime.UtcNow;

                            if (updatedCount > 0)
                            {
                                // If solution is already running, mark as pending instead of expiring again
                                if (_solutionInProgress)
                                {
                                    _pendingExpire = true;
                                }
                                else
                                {
                                    ExpireSolution(true);
                                }
                            }

                            DA.SetData(1,
                                $"Session: {_sessionId}\nStatus: Active\nParameters updated: {updatedCount}\nLast update: {_lastValuesCheck:HH:mm:ss}");
                            return;
                        }
                    }
                }

                var schemaInfo = _embeddedSchema ?? SessionManager.ReadJson<UISchema>(schemaPath);
                if (schemaInfo != null)
                {
                    DA.SetData(1,
                        $"Session: {_sessionId}\nStatus: Active\nSchema: {schemaInfo.Inputs.Count} inputs, {schemaInfo.Outputs.Count} outputs\nSwitch modes in web UI");
                    DA.SetData(2, JsonConvert.SerializeObject(schemaInfo));
                }
                else
                {
                    DA.SetData(1,
                        $"Session: {_sessionId}\nStatus: Active\nWaiting for schema...\nSwitch to Build mode in web UI");
                }

                return;
            }

            // === DISABLED ===
            StopWebSocket();
            _lastValuesCheck = DateTime.MinValue;
            _lastAppliedValues.Clear();
            _previewOpen = false;

            // Show embedded schema info when disabled
            if (_embeddedSchema != null)
            {
                DA.SetData(1,
                    $"Session: {_sessionId}\nStatus: Disabled\nSchema: {_embeddedSchema.Inputs.Count} inputs, {_embeddedSchema.Outputs.Count} outputs (saved)\nSet Enable to true to start");
                DA.SetData(2, JsonConvert.SerializeObject(_embeddedSchema));
            }
            else
            {
                DA.SetData(1, $"Session: {_sessionId}\nStatus: Disabled\nNo schema yet\nSet Enable to true to start");
            }
        }

        protected override void AfterSolveInstance()
        {
            base.AfterSolveInstance();

            // CollectAndSendOutputs(_currentDocument, _embeddedSchema);
        }

        /// <summary>
        /// Scan document and save available parameters
        /// </summary>
        private void ScanAndSaveParameters(GH_Document document)
        {
            // Scan for all contextual parameters and outputs
            var allParams = document.Objects
                .OfType<IGH_ContextualParameter>()
                .ToList();

            var contextOutputs = document.Objects
                .Where(o =>
                {
                    var name = o?.GetType()?.Name;
                    return string.Equals(name, "ContextPrintComponent", StringComparison.Ordinal)
                           || string.Equals(name, "ContextBakeComponent", StringComparison.Ordinal);
                })
                .ToList();

            // Build available parameters list
            var availableParameters = new AvailableParameters
            {
                SessionId = _sessionId,
                Timestamp = DateTime.UtcNow,
                Parameters = new List<AvailableParameter>()
            };

            // Add input parameters
            foreach (var param in allParams)
            {
                var docObj = param as IGH_DocumentObject;
                if (docObj == null) continue;

                var ghParam = param as IGH_Param;
                var availableParam = new AvailableParameter
                {
                    Id = docObj.InstanceGuid,
                    Name = docObj.Name,
                    Nickname = docObj.NickName,
                    Description = docObj.Description ?? "",
                    Category = "input",
                    ParamType = GetParameterTypeName(param),
                    Default = ghParam?.VolatileData.AllData(true).FirstOrDefault()?.ScriptVariable(),
                    AtLeast = param.AtLeast,
                    AtMost = param.AtMost
                };

                // Extract TreeAccess property via reflection
                try
                {
                    var treeAccessProp = param.GetType().GetProperty("TreeAccess");
                    if (treeAccessProp != null)
                    {
                        availableParam.TreeAccess = Convert.ToBoolean(treeAccessProp.GetValue(param, null));
                    }
                }
                catch
                {
                }

                // Extract min/max for sliders
                if (ghParam != null)
                {
                    var slider = ghParam as Grasshopper.Kernel.Special.GH_NumberSlider;
                    if (slider != null)
                    {
                        availableParam.Minimum = (double)slider.Slider.Minimum;
                        availableParam.Maximum = (double)slider.Slider.Maximum;
                    }
                }

                availableParameters.Parameters.Add(availableParam);
            }

            // Add output components
            foreach (var output in contextOutputs)
            {
                if (output == null) continue;

                var component = output as GH_Component;
                IGH_Param outputParam = component?.Params.Input.FirstOrDefault();

                availableParameters.Parameters.Add(new AvailableParameter
                {
                    Id = output.InstanceGuid,
                    Name = output.Name,
                    Nickname = output.NickName,
                    Description = output.Description ?? "",
                    Category = "output",
                    ParamType = outputParam != null ? GetParameterTypeNameFromParam(outputParam) : "Generic",
                    Default = outputParam?.VolatileData.AllData(false).FirstOrDefault()?.ScriptVariable()
                });
            }

            // Check for duplicate names
            var duplicateNames = availableParameters.Parameters
                .GroupBy(p => p.Nickname)
                .Where(g => g.Count() > 1)
                .Select(g => g.Key)
                .ToList();

            if (duplicateNames.Any())
            {
                var duplicateList = string.Join(", ", duplicateNames.Select(n => $"'{n}'"));
                AddRuntimeMessage(GH_RuntimeMessageLevel.Error,
                    $"Duplicate parameter names found: {duplicateList}. Each parameter must have a unique name.");
            }

            // Save available parameters
            SessionManager.WriteJson(SessionManager.GetAvailableParametersPath(_sessionId), availableParameters);
        }


        /// <summary>
        /// Apply values from the web UI to the actual Grasshopper parameters
        /// </summary>
        private int ApplyValuesToParameters(GH_Document document, UISchema schema, Dictionary<string, object> values)
        {
            int updateCount = 0;
            List<IGH_ActiveObject> expiredObjects = new List<IGH_ActiveObject>();

            foreach (var input in schema.Inputs)
            {
                try
                {
                    var paramObject = document.FindObject(input.GrasshopperId, false);
                    if (paramObject == null)
                    {
                        AddRuntimeMessage(GH_RuntimeMessageLevel.Warning,
                            $"Parameter '{input.Name}' not found in document");
                        continue;
                    }

                    var inputKey = input.GrasshopperId.ToString();
                    if (!values.TryGetValue(inputKey, out var value))
                        continue;

                    // Check if the value has changed
                    if (_lastAppliedValues.TryGetValue(inputKey, out var lastValue))
                    {
                        if (value?.ToString() == lastValue?.ToString())
                            continue;
                    }

                    if (paramObject is IGH_ContextualParameter contextParam)
                    {
                        bool success = ApplyToContextualParameter(contextParam, input.Type, value);
                        if (success)
                        {
                            updateCount++;
                            _lastAppliedValues[inputKey] = value;

                            if (paramObject is IGH_ActiveObject activeObj)
                            {
                                expiredObjects.Add(activeObj);
                            }
                        }
                    }
                }
                catch (Exception ex)
                {
                    AddRuntimeMessage(GH_RuntimeMessageLevel.Error,
                        $"Error applying value to '{input.Name}': {ex.Message}");
                }
            }

            return updateCount;
        }

        /// <summary>
        /// Collect output values from Grasshopper parameters and send to web UI
        /// </summary>
        private void CollectAndSendOutputs(GH_Document document, UISchema schema)
{
    if (schema?.Outputs == null || schema.Outputs.Count == 0)
        return;

    var outputValues = new Dictionary<string, object>();

    foreach (var output in schema.Outputs)
    {
        try
        {
            var paramObject = document.FindObject(output.GrasshopperId, false);
            if (paramObject == null)
                continue;

            if (paramObject is IGH_Component ghParam)
            {
                var paramData = ghParam.Params.Input.FirstOrDefault().VolatileData;
                if (paramData != null && !paramData.IsEmpty)
                {
                    var allData = paramData.AllData(true).ToList();
                    if (allData.Count == 1)
                    {
                        outputValues[output.GrasshopperId.ToString()] = ExtractValue(allData[0]);
                    }
                    else if (allData.Count > 1)
                    {
                        var values = allData.Select(d => ExtractValue(d)).ToList();
                        outputValues[output.GrasshopperId.ToString()] = values;
                    }
                }
            }
        }
        catch (Exception ex)
        {
            AddRuntimeMessage(GH_RuntimeMessageLevel.Warning,
                $"Error collecting output '{output.Name}': {ex.Message}");
        }
    }

    if (outputValues.Count > 0)
    {
        try
        {
            var valuesPath = SessionManager.GetValuesPath(_sessionId);
            var existingValues = SessionManager.ReadJson<RuntimeValues>(valuesPath);
            var allValues = existingValues?.Values ?? new Dictionary<string, object>();

            // Only update outputs, preserve all existing inputs
            foreach (var kvp in outputValues)
            {
                allValues[kvp.Key] = kvp.Value;
            }

            var runtimeValues = new RuntimeValues
            {
                Timestamp = DateTime.UtcNow,
                Values = allValues
            };

            SessionManager.WriteJson(valuesPath, runtimeValues);

            if (_useWebSocket && _webSocketServer != null && _webSocketServer.IsRunning)
            {
                var message = new { type = "outputs", sessionId = _sessionId, outputs = outputValues };
                var _ = _webSocketServer.BroadcastAsync(JsonConvert.SerializeObject(message));
            }
        }
        catch (Exception ex)
        {
            AddRuntimeMessage(GH_RuntimeMessageLevel.Warning, $"Error sending output values: {ex.Message}");
        }
    }
}

        /// <summary>
        /// Extract the actual value from a Grasshopper data type
        /// </summary>
        private object ExtractValue(IGH_Goo goo)
        {
            if (goo == null)
                return null;

            // Try to get the script variable (works for most types)
            var scriptVar = goo.ScriptVariable();
            if (scriptVar != null)
                return scriptVar;

            // Fallback to string representation
            return goo.ToString();
        }

        private bool ApplyToContextualParameter(IGH_ContextualParameter contextParam, string inputType, object value)
        {
            try
            {
                var paramTypeName = GetParameterTypeName(contextParam);

                switch (paramTypeName)
                {
                    case "Number":
                        return ApplyNumberValue(contextParam, value);
                    case "Integer":
                        return ApplyIntegerValue(contextParam, value);
                    case "Text":
                        return ApplyTextValue(contextParam, value);
                    case "Boolean":
                        return ApplyBooleanValue(contextParam, value);
                    default:
                        AddRuntimeMessage(GH_RuntimeMessageLevel.Warning,
                            $"Unsupported parameter type: {paramTypeName}");
                        return false;
                }
            }
            catch (Exception ex)
            {
                AddRuntimeMessage(GH_RuntimeMessageLevel.Warning,
                    $"Error applying value: {ex.Message}");
                return false;
            }
        }

        private bool ApplyNumberValue(IGH_ContextualParameter contextParam, object value)
        {
            double numberValue;

            if (value is double d)
                numberValue = d;
            else if (double.TryParse(value?.ToString(), out double parsed))
                numberValue = parsed;
            else
                return false;

            try
            {
                var inputTree = new Grasshopper.DataTree<GH_Number>();
                inputTree.Add(new GH_Number(numberValue), new Grasshopper.Kernel.Data.GH_Path(0));

                var method = contextParam.GetType().GetMethod("AssignContextualDataTree");
                if (method != null)
                {
                    method.Invoke(contextParam, new object[] { inputTree });
                    return true;
                }
            }
            catch (Exception ex)
            {
                AddRuntimeMessage(GH_RuntimeMessageLevel.Warning,
                    $"Failed to apply number value: {ex.Message}");
            }

            return false;
        }

        private bool ApplyIntegerValue(IGH_ContextualParameter contextParam, object value)
        {
            int integerValue;

            if (value is int i)
                integerValue = i;
            else if (value is long l)
                integerValue = (int)l;
            else if (int.TryParse(value?.ToString(), out int parsed))
                integerValue = parsed;
            else
                return false;

            try
            {
                var inputTree = new Grasshopper.DataTree<GH_Integer>();
                inputTree.Add(new GH_Integer(integerValue), new Grasshopper.Kernel.Data.GH_Path(0));

                var method = contextParam.GetType().GetMethod("AssignContextualDataTree");
                if (method != null)
                {
                    method.Invoke(contextParam, new object[] { inputTree });
                    return true;
                }
            }
            catch (Exception ex)
            {
                AddRuntimeMessage(GH_RuntimeMessageLevel.Warning,
                    $"Failed to apply integer value: {ex.Message}");
            }

            return false;
        }

        private bool ApplyTextValue(IGH_ContextualParameter contextParam, object value)
        {
            string textValue = value?.ToString() ?? "";

            var inputTree = new Grasshopper.DataTree<GH_String>();
            inputTree.Add(new GH_String(textValue), new Grasshopper.Kernel.Data.GH_Path(0));

            var method = contextParam.GetType().GetMethod("AssignContextualDataTree");
            if (method != null)
            {
                method.Invoke(contextParam, new object[] { inputTree });
                return true;
            }

            return false;
        }

        private bool ApplyBooleanValue(IGH_ContextualParameter contextParam, object value)
        {
            bool boolValue;

            if (value is bool b)
                boolValue = b;
            else if (bool.TryParse(value?.ToString(), out bool parsed))
                boolValue = parsed;
            else
                return false;

            var inputTree = new Grasshopper.DataTree<GH_Boolean>();
            inputTree.Add(new GH_Boolean(boolValue), new Grasshopper.Kernel.Data.GH_Path(0));

            var method = contextParam.GetType().GetMethod("AssignContextualDataTree");
            if (method != null)
            {
                method.Invoke(contextParam, new object[] { inputTree });
                return true;
            }

            return false;
        }

        private string GetParameterTypeName(IGH_ContextualParameter contextParam)
        {
            if (contextParam is IGH_Param param)
            {
                return GetParameterTypeNameFromParam(param);
            }

            return "Unknown";
        }

        private string GetParameterTypeNameFromParam(IGH_Param param)
        {
            if (param == null) return "Unknown";

            var typeName = param.GetType().Name;

            // Match Compute's parameter type names
            if (typeName.Contains("Number") || typeName.Contains("Slider"))
                return "Number";

            if (typeName.Contains("Integer"))
                return "Integer";

            if (typeName.Contains("Boolean") || typeName.Contains("Toggle"))
                return "Boolean";

            if (typeName.Contains("String") || typeName.Contains("Text") || typeName.Contains("Panel"))
                return "Text";

            if (typeName.Contains("Point"))
                return "Point";

            if (typeName.Contains("Vector"))
                return "Vector";

            if (typeName.Contains("Plane"))
                return "Plane";

            if (typeName.Contains("Line"))
                return "Line";

            if (typeName.Contains("Circle"))
                return "Circle";

            if (typeName.Contains("Rectangle"))
                return "Rectangle";

            if (typeName.Contains("Box"))
                return "Box";

            if (typeName.Contains("Curve"))
                return "Curve";

            if (typeName.Contains("Surface"))
                return "Surface";

            if (typeName.Contains("Brep"))
                return "Brep";

            if (typeName.Contains("Mesh"))
                return "Mesh";

            if (typeName.Contains("SubD"))
                return "SubD";

            if (typeName.Contains("Geometry"))
                return "Geometry";

            return "Generic";
        }

        private void OpenUI()
        {
            try
            {
                // Open the main UI page - user can switch between build/interactive modes there
                var url = $"http://localhost:5173/?session={_sessionId}";
                Process.Start(new ProcessStartInfo
                {
                    FileName = url,
                    UseShellExecute = true
                });
            }
            catch (Exception ex)
            {
                AddRuntimeMessage(GH_RuntimeMessageLevel.Warning,
                    $"Could not open browser: {ex.Message}");
            }
        }

        private void StartWebSocket()
        {
            if (_webSocketServer != null && _webSocketServer.IsRunning)
                return;

            try
            {
                _webSocketServer = new WebSocketServer(WEBSOCKET_PORT);

                _webSocketServer.OnMessageReceived += (sender, message) =>
                {
                    try
                    {
                        var msg = JsonConvert.DeserializeObject<WebSocketMessage>(message);

                        if (msg.Type == "valueUpdate")
                        {
                            var valueMsg = JsonConvert.DeserializeObject<ValueUpdateMessage>(message);
                            if (valueMsg != null && valueMsg.SessionId == _sessionId)
                            {
                                var document = this.OnPingDocument();
                                var schema =
                                    SessionManager.ReadJson<UISchema>(SessionManager.GetSchemaPath(_sessionId));

                                if (document != null && schema != null)
                                {
                                    int updated = ApplyValuesToParameters(document, schema, valueMsg.Values);
                                    if (updated > 0)
                                    {
                                        // Update timestamp to prevent file polling from re-applying these values
                                        _lastValuesCheck = DateTime.UtcNow;

                                        // If solution is already running, mark as pending instead of expiring again
                                        if (_solutionInProgress)
                                        {
                                            _pendingExpire = true;
                                        }
                                        else
                                        {
                                            Rhino.RhinoApp.InvokeOnUiThread((Action)(() => { ExpireSolution(true); }));
                                        }
                                    }
                                }
                            }
                        }
                    }
                    catch (Exception ex)
                    {
                        AddRuntimeMessage(GH_RuntimeMessageLevel.Warning, $"WebSocket message error: {ex.Message}");
                    }
                };

                _webSocketServer.OnClientConnected += (sender, client) =>
                {
                    AddRuntimeMessage(GH_RuntimeMessageLevel.Remark, $"Web UI connected via WebSocket");
                };

                _webSocketServer.StartAsync().Wait();

                AddRuntimeMessage(GH_RuntimeMessageLevel.Remark, $"WebSocket server started on port {WEBSOCKET_PORT}");
            }
            catch (Exception ex)
            {
                AddRuntimeMessage(GH_RuntimeMessageLevel.Warning,
                    $"Could not start WebSocket server: {ex.Message}. Falling back to file-based communication.");
                _useWebSocket = false;
            }
        }

        public override void RemovedFromDocument(GH_Document document)
        {
            base.RemovedFromDocument(document);
            Cleanup();
        }

        private void RegisterDocumentEvents()
        {
            if (_currentDocument == null || _eventsRegistered)
                return;

            try
            {
                Grasshopper.Instances.DocumentServer.DocumentRemoved += OnDocumentRemoved;
            }
            catch { /* ignore */ }

            try
            {
                _currentDocument.SolutionStart += OnSolutionStart;
                _currentDocument.SolutionEnd += OnSolutionEnd;
            }
            catch { /* ignore */ }

            _eventsRegistered = true;
        }

        private void UnregisterDocumentEvents()
        {
            if (!_eventsRegistered)
                return;

            try
            {
                Grasshopper.Instances.DocumentServer.DocumentRemoved -= OnDocumentRemoved;
            }
            catch { /* ignore */ }

            if (_currentDocument != null)
            {
                try
                {
                    _currentDocument.SolutionStart -= OnSolutionStart;
                    _currentDocument.SolutionEnd -= OnSolutionEnd;
                }
                catch { /* ignore */ }
            }

            _eventsRegistered = false;
        }

        private void OnDocumentRemoved(GH_DocumentServer sender, GH_Document doc)
        {
            // Check if the removed document is the one we're tracking
            if (_currentDocument != null && doc != null && doc.DocumentID == _currentDocument.DocumentID)
            {
                Cleanup();
            }
        }

        private void OnSolutionStart(object sender, GH_SolutionEventArgs e)
        {
            _solutionInProgress = true;
        }

        private void OnSolutionEnd(object sender, GH_SolutionEventArgs e)
        {
            _solutionEndCount++;
            _solutionInProgress = false;
            Debug.WriteLine($"OnSolutionEnd invoked {_solutionEndCount} time(s) for document {(_currentDocument?.DocumentID.ToString() ?? "null")}");

            // Only collect outputs if we're enabled and have a schema
            if (_embeddedSchema != null && _currentDocument != null)
            {
                CollectAndSendOutputs(_currentDocument, _embeddedSchema);
            }

            // If there's a pending expire, trigger it now
            if (_pendingExpire)
            {
                _pendingExpire = false;
                Rhino.RhinoApp.InvokeOnUiThread((Action)(() => { ExpireSolution(true); }));
            }
        }

        private void Cleanup()
        {
            StopWebSocket();
            UnregisterDocumentEvents();
            _currentDocument = null;
            _previewOpen = false;
            _lastValuesCheck = DateTime.MinValue;
            _lastAppliedValues.Clear();
            _solutionInProgress = false;
            _pendingExpire = false;
        }

        private void StopWebSocket()
        {
            if (_webSocketServer != null)
            {
                try
                {
                    _webSocketServer.Stop();
                    _webSocketServer.Dispose();
                }
                catch (Exception ex)
                {
                    // Suppress exceptions during cleanup
                    System.Diagnostics.Debug.WriteLine($"Error stopping WebSocket: {ex.Message}");
                }
                finally
                {
                    _webSocketServer = null;
                }
            }
        }

        // IDisposable implementation
        public void Dispose()
        {
            Dispose(true);
            GC.SuppressFinalize(this);
        }

        protected virtual void Dispose(bool disposing)
        {
            if (_disposed)
                return;

            if (disposing)
            {
                // Dispose managed resources
                Cleanup();
            }

            _disposed = true;
        }

        // Schema persistence - save/load with .gh file
        public override bool Write(GH_IO.Serialization.GH_IWriter writer)
        {
            // Save session ID
            if (!string.IsNullOrEmpty(_sessionId))
            {
                writer.SetString("SessionId", _sessionId);
            }

            // Save embedded schema
            if (_embeddedSchema != null)
            {
                try
                {
                    string schemaJson = JsonConvert.SerializeObject(_embeddedSchema);
                    writer.SetString("Schema", schemaJson);
                }
                catch (Exception ex)
                {
                    AddRuntimeMessage(GH_RuntimeMessageLevel.Warning,
                        $"Could not save schema: {ex.Message}");
                }
            }

            // Save embedded values (last applied parameter values)
            if (_lastAppliedValues != null && _lastAppliedValues.Count > 0)
            {
                try
                {
                    string valuesJson = JsonConvert.SerializeObject(_lastAppliedValues);
                    writer.SetString("Values", valuesJson);
                }
                catch (Exception ex)
                {
                    AddRuntimeMessage(GH_RuntimeMessageLevel.Warning,
                        $"Could not save values: {ex.Message}");
                }
            }

            return base.Write(writer);
        }

        public override bool Read(GH_IO.Serialization.GH_IReader reader)
        {
            // Restore session ID
            if (reader.ItemExists("SessionId"))
            {
                _sessionId = reader.GetString("SessionId");
            }

            // Restore embedded schema
            if (reader.ItemExists("Schema"))
            {
                try
                {
                    string schemaJson = reader.GetString("Schema");
                    if (!string.IsNullOrEmpty(schemaJson))
                    {
                        _embeddedSchema = JsonConvert.DeserializeObject<UISchema>(schemaJson);
                    }
                }
                catch (Exception ex)
                {
                    AddRuntimeMessage(GH_RuntimeMessageLevel.Warning,
                        $"Could not load schema: {ex.Message}");
                }
            }

            // Restore embedded values
            if (reader.ItemExists("Values"))
            {
                try
                {
                    string valuesJson = reader.GetString("Values");
                    if (!string.IsNullOrEmpty(valuesJson))
                    {
                        _embeddedValues = JsonConvert.DeserializeObject<Dictionary<string, object>>(valuesJson);
                    }
                }
                catch (Exception ex)
                {
                    AddRuntimeMessage(GH_RuntimeMessageLevel.Warning,
                        $"Could not load values: {ex.Message}");
                }
            }

            return base.Read(reader);
        }

        protected override System.Drawing.Bitmap Icon => null;
    }
}