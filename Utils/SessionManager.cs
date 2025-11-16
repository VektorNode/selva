using System;
using System.IO;
using Newtonsoft.Json;

namespace ComputeBuilder.Utils
{
    /// <summary>
    /// Manages session-based file storage for communication between Grasshopper and the web UI
    /// </summary>
    public static class SessionManager
    {
        private static readonly string TempDirectory = Path.Combine(Path.GetTempPath(), "ComputeBuilder");

        static SessionManager()
        {
            // Ensure temp directory exists
            if (!Directory.Exists(TempDirectory))
            {
                Directory.CreateDirectory(TempDirectory);
            }
        }

        /// <summary>
        /// Get the file path for a session's schema
        /// </summary>
        public static string GetSchemaPath(string sessionId)
        {
            return Path.Combine(TempDirectory, $"{sessionId}_schema.json");
        }

        /// <summary>
        /// Get the file path for a session's values
        /// </summary>
        public static string GetValuesPath(string sessionId)
        {
            return Path.Combine(TempDirectory, $"{sessionId}_values.json");
        }

        /// <summary>
        /// Get the file path for a session's state
        /// </summary>
        public static string GetStatePath(string sessionId)
        {
            return Path.Combine(TempDirectory, $"{sessionId}_state.json");
        }

        /// <summary>
        /// Get the file path for a session's available parameters
        /// </summary>
        public static string GetAvailableParametersPath(string sessionId)
        {
            return Path.Combine(TempDirectory, $"{sessionId}_available.json");
        }

        /// <summary>
        /// Write an object to a session file as JSON
        /// </summary>
        public static void WriteJson<T>(string filePath, T data)
        {
            var json = JsonConvert.SerializeObject(data, Formatting.Indented);
            File.WriteAllText(filePath, json);
        }

        /// <summary>
        /// Read an object from a session file
        /// </summary>
        public static T ReadJson<T>(string filePath)
        {
            if (!File.Exists(filePath))
            {
                return default(T);
            }

            var json = File.ReadAllText(filePath);
            return JsonConvert.DeserializeObject<T>(json);
        }

        /// <summary>
        /// Check if a session file has been modified since a given time
        /// </summary>
        public static bool HasBeenModified(string filePath, DateTime since)
        {
            if (!File.Exists(filePath))
            {
                return false;
            }

            return File.GetLastWriteTimeUtc(filePath) > since;
        }
       
    }
}
