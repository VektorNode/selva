using System;
using System.Collections.Generic;
using ComputeBuilder.Models;

namespace ComputeBuilder.Utils
{
    /// <summary>
    /// Manages schema and value persistence (embedded and session files)
    /// WebSocket-only version - no file polling
    /// </summary>
    public class PersistenceManager
    {
        private readonly string _sessionId;

        public PersistenceManager(string sessionId)
        {
            _sessionId = sessionId;
        }

        /// <summary>
        /// Save schema to session file
        /// </summary>
        public void SaveSchema(UISchema schema)
        {
            SessionManager.WriteJson(SessionManager.GetSchemaPath(_sessionId), schema);
        }

        /// <summary>
        /// Load schema from session file
        /// </summary>
        public UISchema LoadSchema()
        {
            return SessionManager.ReadJson<UISchema>(SessionManager.GetSchemaPath(_sessionId));
        }

        /// <summary>
        /// Save values to session file
        /// </summary>
        public void SaveValues(Dictionary<string, object> values)
        {
            var runtimeValues = new RuntimeValues
            {
                Timestamp = DateTime.UtcNow,
                Values = values
            };
            SessionManager.WriteJson(SessionManager.GetValuesPath(_sessionId), runtimeValues);
        }

        /// <summary>
        /// Load values from session file
        /// </summary>
        public RuntimeValues LoadValues()
        {
            return SessionManager.ReadJson<RuntimeValues>(SessionManager.GetValuesPath(_sessionId));
        }

        /// <summary>
        /// Save available parameters to session file
        /// </summary>
        public void SaveAvailableParameters(AvailableParameters parameters)
        {
            SessionManager.WriteJson(SessionManager.GetAvailableParametersPath(_sessionId), parameters);
        }

        /// <summary>
        /// Load available parameters from session file
        /// </summary>
        public AvailableParameters LoadAvailableParameters()
        {
            return SessionManager.ReadJson<AvailableParameters>(SessionManager.GetAvailableParametersPath(_sessionId));
        }

        /// <summary>
        /// Save session state
        /// </summary>
        public void SaveSessionState(bool active)
        {
            var sessionState = new SessionState
            {
                SessionId = _sessionId,
                Active = active,
                Mode = "active",
                LastUpdate = DateTime.UtcNow
            };
            SessionManager.WriteJson(SessionManager.GetStatePath(_sessionId), sessionState);
        }

        /// <summary>
        /// Load session state
        /// </summary>
        public SessionState LoadSessionState()
        {
            return SessionManager.ReadJson<SessionState>(SessionManager.GetStatePath(_sessionId));
        }
    }
}
