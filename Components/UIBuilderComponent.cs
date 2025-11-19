using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using Grasshopper.Kernel;
using Grasshopper.Kernel.Types;
using ComputeBuilder.Utils;
using ComputeBuilder.Models;
using Newtonsoft.Json;

namespace ComputeBuilder.Components
{
    /// <summary>
    /// Unified UI Builder component - WebSocket-only version
    /// Switch between Schema Builder mode and Interactive Preview mode
    /// </summary>
    public class UIBuilderComponent : GH_Component, IDisposable
    {
        private string _sessionId;
        private bool _previewOpen = false;
        private bool _disposed = false;
        private GH_Document _currentDocument;
        private bool _eventsRegistered = false;

        // Embedded schema - persists with the .gh file
        private UISchema _embeddedSchema = null;

        // Embedded values - persists parameter values with the .gh file
        private Dictionary<string, object> _embeddedValues = null;

        // Cache for available parameters (to send on client connect)
        private AvailableParameters _availableParams = null;

        // Extracted responsibilities
        private SchemaManager _schemaManager;
        private ValueApplicator _valueApplicator;
        private CommunicationHandler _communicationHandler;

        public UIBuilderComponent()
            : base("UI Builder", "UIBuilder",
                "Build and interact with your UI - WebSocket-only communication",
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
            pManager.AddBooleanParameter("Open Preview", "OpenPreview", "Open the interactive preview in a web browser",
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
            bool openPreview = false;

            DA.GetData(0, ref enable);
            DA.GetData(1, ref refresh);
            DA.GetData(2, ref openPreview);
            
            // Initialize components on first run
            if (_schemaManager == null)
            {
                if (string.IsNullOrEmpty(_sessionId))
                {
                    _sessionId = Guid.NewGuid().ToString().Substring(0, 8);
                }

                _schemaManager = new SchemaManager(_sessionId);
                _valueApplicator = new ValueApplicator();
                _communicationHandler = new CommunicationHandler(_sessionId);

                _communicationHandler.OnValuesReceived += HandleWebSocketValueUpdate;
                _communicationHandler.OnCurrentValuesRequested += HandleCurrentValuesRequest;
                _communicationHandler.OnClientConnected += HandleClientConnected;
                _communicationHandler.OnSchemaSaveRequested += HandleSchemaSave;
            }

            DA.SetData(0, _sessionId);

            var document = this.OnPingDocument();
            if (document == null)
            {
                AddRuntimeMessage(GH_RuntimeMessageLevel.Error, "Could not access Grasshopper document");
                DA.SetData(1, "ERROR: No document");
                return;
            }

            var isRunningInHeadless = Rhino.RhinoDoc.ActiveDoc == null || Rhino.RhinoApp.IsRunningHeadless || Rhino.RhinoDoc.ActiveDoc.IsHeadless;

            if (isRunningInHeadless)
            {
                if (enable || refresh)
                {
                    _availableParams = _schemaManager.ScanParameters(document);
                    var duplicates = _schemaManager.ValidateDuplicates(_availableParams);

                    if (duplicates.Any())
                    {
                        var duplicateList = string.Join(", ", duplicates.Select(n => $"'{n}'"));
                        AddRuntimeMessage(GH_RuntimeMessageLevel.Error,
                            $"Duplicate parameter names found: {duplicateList}. Each parameter must have a unique name.");
                    }
                }

                // Load and validate embedded schema/values only
                if (_embeddedSchema != null)
                {
                    _embeddedSchema = _schemaManager.ValidateSchema(_embeddedSchema, document);
                }

                if (_embeddedValues != null && _embeddedSchema != null)
                {
                    _valueApplicator.ApplyValuesAndSchedule(document, _embeddedSchema, _embeddedValues, AddRuntimeMessage);
                }

                DA.SetData(1, $"Session: {_sessionId}\nStatus: Headless Mode\nSchema loaded (no WebSocket)");
                DA.SetData(2, _embeddedSchema != null ? JsonConvert.SerializeObject(_embeddedSchema) : "");
                return;
            }

            // Register document events for cleanup
            if (_currentDocument != document)
            {
                UnregisterDocumentEvents();
                _currentDocument = document;
                RegisterDocumentEvents();
            }

            // Scan parameters on enable or refresh
            if (enable || refresh)
            {
                _availableParams = _schemaManager.ScanParameters(document);
                var duplicates = _schemaManager.ValidateDuplicates(_availableParams);

                if (duplicates.Any())
                {
                    var duplicateList = string.Join(", ", duplicates.Select(n => $"'{n}'"));
                    AddRuntimeMessage(GH_RuntimeMessageLevel.Error,
                        $"Duplicate parameter names found: {duplicateList}. Each parameter must have a unique name.");
                }
            }

            // === ENABLED ===
            if (enable)
            {
                // Start WebSocket server
                if (!_communicationHandler.IsRunning)
                {
                    try
                    {
                        _communicationHandler.Start((msg) => Message = msg);
                        
                    }
                    catch (Exception ex)
                    {
                        AddRuntimeMessage(GH_RuntimeMessageLevel.Error,
                            $"Failed to start WebSocket server: {ex.Message}");
                        DA.SetData(1, "ERROR: Could not start WebSocket");
                        return;
                    }
                }

                // Validate and apply embedded schema/values on first enable
                if (_embeddedSchema != null && !_previewOpen)
                {
                    _embeddedSchema = _schemaManager.ValidateSchema(_embeddedSchema, document);
                }

                // Apply embedded values to Grasshopper parameters on first enable
                if (_embeddedValues != null && !_previewOpen && _embeddedSchema != null)
                {
                    int updatedCount = _valueApplicator.ApplyValuesAndSchedule(
                        document,
                        _embeddedSchema,
                        _embeddedValues,
                        AddRuntimeMessage);

                    if (updatedCount > 0)
                    {
                        _valueApplicator.SetLastAppliedValues(_embeddedValues);
                    }
                }

                if (openPreview && !_previewOpen)
                {
                    OpenUI();
                    _previewOpen = true;
                }

                if (_embeddedSchema != null)
                {
                    DA.SetData(1,
                        $"Session: {_sessionId}\nStatus: Active (WebSocket)\nSchema: {_embeddedSchema.Inputs.Count} inputs, {_embeddedSchema.Outputs.Count} outputs\nSwitch modes in web UI");
                    DA.SetData(2, JsonConvert.SerializeObject(_embeddedSchema));
                }
                else
                {
                    DA.SetData(1,
                        $"Session: {_sessionId}\nStatus: Active (WebSocket)\nWaiting for schema...\nSwitch to Build mode in web UI");
                }

                return;
            }

            // === DISABLED ===
            _communicationHandler?.Stop();
            _valueApplicator?.Clear();
            _previewOpen = false;
            Message = "WebSocket Inactive";

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

            // Note: Output collection happens in OnSolutionEnd event handler
            // to ensure all components have finished computing
        }

        /// <summary>
        /// Handle value updates received via WebSocket
        /// </summary>
        private void HandleWebSocketValueUpdate(object sender, Dictionary<string, object> values)
        {
            try
            {
                var document = this.OnPingDocument();
                if (document == null || _embeddedSchema == null)
                    return;

                // Apply values and schedule solution
                int updated = _valueApplicator.ApplyValuesAndSchedule(document, _embeddedSchema, values, AddRuntimeMessage);

                if (updated > 0)
                {
                    // Update embedded values (will be saved with .gh file)
                    _embeddedValues = new Dictionary<string, object>(values);
                }
            }
            catch (Exception ex)
            {
                AddRuntimeMessage(GH_RuntimeMessageLevel.Error, $"Error handling value update: {ex.Message}");
            }
        }

        /// <summary>
        /// Handle client connection - send initial data
        /// </summary>
        private void HandleClientConnected(object sender, EventArgs e)
        {
            try
            {
                var document = this.OnPingDocument();
                if (document == null)
                    return;

                // Get current values from parameters
                var currentValues = CollectCurrentValues(document);

                // Broadcast initial data to the newly connected client
                var _ = _communicationHandler.BroadcastInitialData(_embeddedSchema, _availableParams, currentValues);
            }
            catch (Exception ex)
            {
                AddRuntimeMessage(GH_RuntimeMessageLevel.Error, $"Error sending initial data: {ex.Message}");
            }
        }

        /// <summary>
        /// Handle schema save request from web UI
        /// </summary>
        private void HandleSchemaSave(object sender, UISchema schema)
        {
            try
            {
                var document = this.OnPingDocument();
                if (document == null)
                {
                    var _ = _communicationHandler.BroadcastSchemaSaved(false, "No document available");
                    return;
                }

                // Validate and store the schema
                _embeddedSchema = _schemaManager.ValidateSchema(schema, document);

                // Broadcast success
                var task = _communicationHandler.BroadcastSchemaSaved(true);

                AddRuntimeMessage(GH_RuntimeMessageLevel.Remark, "Schema saved successfully");
            }
            catch (Exception ex)
            {
                var _ = _communicationHandler.BroadcastSchemaSaved(false, ex.Message);
                AddRuntimeMessage(GH_RuntimeMessageLevel.Error, $"Error saving schema: {ex.Message}");
            }
        }

        /// <summary>
        /// Collect current values from all input parameters
        /// </summary>
        private Dictionary<string, object> CollectCurrentValues(GH_Document document)
        {
            var currentValues = new Dictionary<string, object>();

            if (_embeddedSchema == null)
                return currentValues;

            foreach (var input in _embeddedSchema.Inputs)
            {
                try
                {
                    var paramObject = document.FindObject(input.Id, false);
                    if (paramObject == null)
                        continue;

                    if (paramObject is IGH_Param ghParam)
                    {
                        if (ghParam.SourceCount == 1)
                        {
                            var valueData = ghParam.Sources[0].VolatileData;
                            if (valueData != null && !valueData.IsEmpty)
                            {
                                var allData = valueData.AllData(true).ToList();
                                if (allData.Count == 1)
                                {
                                    currentValues[input.Id.ToString()] = ExtractValue(allData[0]);
                                }
                                else if (allData.Count > 1)
                                {
                                    var values = allData.Select(d => ExtractValue(d)).ToList();
                                    currentValues[input.Id.ToString()] = values;
                                }
                            }
                        }
                    }
                }
                catch (Exception ex)
                {
                    AddRuntimeMessage(GH_RuntimeMessageLevel.Warning,
                        $"Error collecting current value for '{input.Name}': {ex.Message}");
                }
            }

            return currentValues;
        }

        /// <summary>
        /// Handle request for current input values from web UI
        /// </summary>
        private void HandleCurrentValuesRequest(object sender, EventArgs e)
        {
            try
            {
                var document = this.OnPingDocument();
                if (document == null || _embeddedSchema == null)
                    return;

                var currentValues = CollectCurrentValues(document);

                // Broadcast current values to web UI
                if (currentValues.Count > 0)
                {
                    var _ = _communicationHandler.BroadcastCurrentValues(currentValues);
                }
            }
            catch (Exception ex)
            {
                AddRuntimeMessage(GH_RuntimeMessageLevel.Error,
                    $"Error handling current values request: {ex.Message}");
            }
        }

        /// <summary>
        /// Collect output values and send via WebSocket
        /// </summary>
        private void CollectAndSendOutputs(GH_Document document, UISchema schema)
        {
            if (document == null || schema?.Outputs == null || schema.Outputs.Count == 0)
                return;

            if (!_communicationHandler.IsRunning)
                return;

            var outputValues = new Dictionary<string, object>();

            foreach (var output in schema.Outputs)
            {
                try
                {
                    var paramObject = document.FindObject(output.Id, false);
                    if (paramObject == null)
                        continue;

                    if (paramObject is IGH_Component ghParam)
                    {
                        var paramData = ghParam.Params.Input.FirstOrDefault()?.VolatileData;
                        if (paramData != null && !paramData.IsEmpty)
                        {
                            var allData = paramData.AllData(true).ToList();
                            if (allData.Count == 1)
                            {
                                outputValues[output.Id.ToString()] = ExtractValue(allData[0]);
                            }
                            else if (allData.Count > 1)
                            {
                                var values = allData.Select(d => ExtractValue(d)).ToList();
                                outputValues[output.Id.ToString()] = values;
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
                    // Broadcast via WebSocket
                    var _ = _communicationHandler.BroadcastOutputs(outputValues);
                }
                catch (Exception ex)
                {
                    AddRuntimeMessage(GH_RuntimeMessageLevel.Warning, $"Error sending outputs: {ex.Message}");
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

            if (!goo.IsValid)
                return null;

            try
            {
                var scriptVar = goo.ScriptVariable();
                if (scriptVar != null)
                    return scriptVar;

                return goo.ToString();
            }
            catch (Exception)
            {
                return null;
            }
        }

        private void OpenUI()
        {
            try
            {
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
                _currentDocument.SolutionEnd += OnSolutionEnd;
                _currentDocument.ObjectsAdded += OnObjectsChanged;
                _currentDocument.ObjectsDeleted += OnObjectsChanged;
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
                    _currentDocument.SolutionEnd -= OnSolutionEnd;
                    _currentDocument.ObjectsAdded -= OnObjectsChanged;
                    _currentDocument.ObjectsDeleted -= OnObjectsChanged;
                }
                catch { /* ignore */ }
            }

            _eventsRegistered = false;
        }

        private void OnDocumentRemoved(GH_DocumentServer sender, GH_Document doc)
        {
            if (_currentDocument != null && doc != null && doc.DocumentID == _currentDocument.DocumentID)
            {
                Cleanup();
            }
        }

        private void OnSolutionEnd(object sender, GH_SolutionEventArgs e)
        {
            if (_embeddedSchema != null && _currentDocument != null)
            {
                CollectAndSendOutputs(_currentDocument, _embeddedSchema);
            }
        }

        private void OnObjectsChanged(object sender, GH_DocObjectEventArgs e)
        {
            // Only react if we have an active schema and are enabled
            if (_embeddedSchema == null || _currentDocument == null || !_communicationHandler.IsRunning)
                return;

            // Check if any changed objects are contextual parameters or output components
            bool relevantChange = false;
            foreach (var obj in e.Objects)
            {
                if (obj is IGH_ContextualParameter)
                {
                    relevantChange = true;
                    break;
                }

                if (ParameterTypeHelper.IsContextOutputComponent(obj))
                {
                    relevantChange = true;
                    break;
                }
            }

            if (!relevantChange)
                return;

            try
            {
                var (updatedSchema, removedIds) = _schemaManager.ValidateSchemaAndTrackChanges(_embeddedSchema, _currentDocument);

                if (removedIds.Count > 0)
                {
                    _embeddedSchema = updatedSchema;

                    if (_embeddedValues != null)
                    {
                        foreach (var removedId in removedIds)
                        {
                            _embeddedValues.Remove(removedId.ToString());
                        }
                    }

                    var lastValues = _valueApplicator?.GetLastAppliedValues();
                    if (lastValues != null)
                    {
                        foreach (var removedId in removedIds)
                        {
                            lastValues.Remove(removedId.ToString());
                        }
                        _valueApplicator?.SetLastAppliedValues(lastValues);
                    }

                    var broadcastTask = _communicationHandler.BroadcastSchemaUpdate(_embeddedSchema, removedIds);

                    try
                    {
                        broadcastTask.Wait(10);
                    }
                    catch
                    {
                    }

                    AddRuntimeMessage(GH_RuntimeMessageLevel.Remark,
                        $"Schema updated: {removedIds.Count} parameter(s) removed from UI");

                    _currentDocument.ScheduleSolution(10, doc =>
                    {
                        ExpireSolution(false);
                    });
                }
            }
            catch (Exception ex)
            {
                AddRuntimeMessage(GH_RuntimeMessageLevel.Warning,
                    $"Error updating schema: {ex.Message}");
            }
        }

        private void Cleanup()
        {
            _communicationHandler?.Stop();
            UnregisterDocumentEvents();
            _valueApplicator?.Clear();
            _currentDocument = null;
            _previewOpen = false;
        }

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
                Cleanup();
                _communicationHandler?.Dispose();
            }

            _disposed = true;
        }

        // Schema persistence - save/load with .gh file
        public override bool Write(GH_IO.Serialization.GH_IWriter writer)
        {
            if (!string.IsNullOrEmpty(_sessionId))
            {
                writer.SetString("SessionId", _sessionId);
            }

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

            var lastValues = _valueApplicator?.GetLastAppliedValues();
            if (lastValues != null && lastValues.Count > 0)
            {
                try
                {
                    string valuesJson = JsonConvert.SerializeObject(lastValues);
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
            if (reader.ItemExists("SessionId"))
            {
                _sessionId = reader.GetString("SessionId");
            }

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
