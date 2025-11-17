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
        private int _solutionEndCount = 0;
        private bool _solutionInProgress = false;
        private bool _pendingExpire = false;

        // Embedded schema - persists with the .gh file
        private UISchema _embeddedSchema = null;
        private DateTime _lastSchemaSync = DateTime.MinValue;

        // Embedded values - persists parameter values with the .gh file
        private Dictionary<string, object> _embeddedValues = null;

        // Extracted responsibilities
        private SchemaManager _schemaManager;
        private ValueApplicator _valueApplicator;
        private CommunicationHandler _communicationHandler;
        private PersistenceManager _persistenceManager;

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

            // Initialize components on first run
            if (_schemaManager == null)
            {
                _sessionId = Guid.NewGuid().ToString().Substring(0, 8);
                _schemaManager = new SchemaManager(_sessionId);
                _valueApplicator = new ValueApplicator();
                _communicationHandler = new CommunicationHandler(_sessionId);
                _persistenceManager = new PersistenceManager(_sessionId);

                // Hook up WebSocket value updates
                _communicationHandler.OnValuesReceived += HandleWebSocketValueUpdate;
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

            // Scan parameters on enable or refresh
            if (enable || refresh)
            {
                var availableParams = _schemaManager.ScanParameters(document);
                var duplicates = _schemaManager.ValidateDuplicates(availableParams);

                if (duplicates.Any())
                {
                    var duplicateList = string.Join(", ", duplicates.Select(n => $"'{n}'"));
                    AddRuntimeMessage(GH_RuntimeMessageLevel.Error,
                        $"Duplicate parameter names found: {duplicateList}. Each parameter must have a unique name.");
                }

                _persistenceManager.SaveAvailableParameters(availableParams);
            }

            // === ENABLED ===
            if (enable)
            {
                // Start WebSocket server
                if (!_communicationHandler.IsRunning)
                {
                    try
                    {
                        _communicationHandler.Start((msg) => AddRuntimeMessage(GH_RuntimeMessageLevel.Remark, msg));
                    }
                    catch (Exception ex)
                    {
                        AddRuntimeMessage(GH_RuntimeMessageLevel.Error,
                            $"Failed to start WebSocket server: {ex.Message}");
                        DA.SetData(1, "ERROR: Could not start WebSocket");
                        return;
                    }
                }

                // Load embedded schema to temp files on first enable
                if (_embeddedSchema != null && !_previewOpen)
                {
                    _persistenceManager.SaveSchema(_embeddedSchema);
                    _lastSchemaSync = DateTime.UtcNow;
                }

                // Load embedded values and apply to parameters on first enable
                if (_embeddedValues != null && !_previewOpen)
                {
                    // Write values to temp file for web UI
                    _persistenceManager.SaveValues(_embeddedValues);

                    // Apply values immediately to Grasshopper parameters
                    if (_embeddedSchema != null)
                    {
                        int updatedCount = _valueApplicator.ApplyValues(
                            document,
                            _embeddedSchema,
                            _embeddedValues,
                            AddRuntimeMessage);

                        if (updatedCount > 0)
                        {
                            _valueApplicator.SetLastAppliedValues(_embeddedValues);
                        }
                    }
                }

                // Update session state as active
                _persistenceManager.SaveSessionState(true);

                // Open UI (only once)
                if (!_previewOpen)
                {
                    OpenUI();
                    _previewOpen = true;
                }

                // Check if schema has been modified in the web UI (initial load only)
                var schemaPath = SessionManager.GetSchemaPath(_sessionId);
                if (SessionManager.HasBeenModified(schemaPath, _lastSchemaSync))
                {
                    var updatedSchema = _persistenceManager.LoadSchema();
                    if (updatedSchema != null)
                    {
                        _embeddedSchema = updatedSchema;
                        _lastSchemaSync = DateTime.UtcNow;
                    }
                }

                // Display status
                var schemaInfo = _embeddedSchema ?? _persistenceManager.LoadSchema();
                if (schemaInfo != null)
                {
                    DA.SetData(1,
                        $"Session: {_sessionId}\nStatus: Active (WebSocket)\nSchema: {schemaInfo.Inputs.Count} inputs, {schemaInfo.Outputs.Count} outputs\nSwitch modes in web UI");
                    DA.SetData(2, JsonConvert.SerializeObject(schemaInfo));
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

            // Collect and send outputs via WebSocket
            CollectAndSendOutputs(_currentDocument, _embeddedSchema);
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

                int updated = _valueApplicator.ApplyValues(document, _embeddedSchema, values, AddRuntimeMessage);

                if (updated > 0)
                {
                    // Save values to file for persistence
                    _persistenceManager.SaveValues(values);

                    // Update embedded values
                    _embeddedValues = new Dictionary<string, object>(values);

                    // Trigger solution
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
            catch (Exception ex)
            {
                AddRuntimeMessage(GH_RuntimeMessageLevel.Error, $"Error handling value update: {ex.Message}");
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
                    var paramObject = document.FindObject(output.GrasshopperId, false);
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
                    // Update values file (merge with inputs)
                    var existingValues = _persistenceManager.LoadValues();
                    var allValues = existingValues?.Values ?? new Dictionary<string, object>();

                    foreach (var kvp in outputValues)
                    {
                        allValues[kvp.Key] = kvp.Value;
                    }

                    _persistenceManager.SaveValues(allValues);

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

            var scriptVar = goo.ScriptVariable();
            if (scriptVar != null)
                return scriptVar;

            return goo.ToString();
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

            // Collect outputs after solution completes
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
            _communicationHandler?.Stop();
            UnregisterDocumentEvents();
            _valueApplicator?.Clear();
            _currentDocument = null;
            _previewOpen = false;
            _solutionInProgress = false;
            _pendingExpire = false;
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
                Cleanup();
                _communicationHandler?.Dispose();
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
