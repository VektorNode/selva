using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Selva.Core.Models;

namespace Selva.Core.Services;

/// <summary>
///   Handles automatic backups of schemas before migration, and a save-triggered history log.
/// </summary>
public static class SchemaBackupService
{
	private const int MaxHistoryEntries = 10;
	private const int MaxMigrationBackupsPerSchema = 10;

	private static readonly JsonSerializerSettings BackupSerializationSettings = new()
	{
		Formatting = Formatting.Indented,
		NullValueHandling = NullValueHandling.Ignore
	};

	private static string GetBackupDirectory()
	{
		var appData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
		return Path.Combine(appData, "Grasshopper", "Selva", "SchemaBackups");
	}

	// ─────────────────────────────────────────────────────────────
	//  1. Pre-migration backup (called before migration on load)
	// ─────────────────────────────────────────────────────────────

	/// <summary>
	///   Creates a backup of the raw pre-migration JSON before any deserialization/migration occurs.
	///   <paramref name="rawJson"/> is the original schema JSON string as stored in the .gh file.
	///   <paramref name="onWarning"/> receives a warning message if the backup fails (never throws).
	/// </summary>
	public static string CreateMigrationBackup(string rawJson, string schemaName, string schemaVersion,
		Action<string> onWarning = null, string backupDirectory = null)
	{
		if (string.IsNullOrEmpty(rawJson)) return null;

		try
		{
			backupDirectory ??= GetBackupDirectory();
			Directory.CreateDirectory(backupDirectory);

			var version = SanitizeFilename(schemaVersion ?? "unknown");
			var timestamp = DateTime.UtcNow.ToString("yyyyMMdd_HHmmss");
			var name = SanitizeFilename(schemaName ?? "untitled");
			var filename = $"migration_backup_{name}_v{version}_{timestamp}.json";
			var backupPath = Path.Combine(backupDirectory, filename);

			File.WriteAllText(backupPath, rawJson);

			CleanupOldFiles(backupDirectory, $"migration_backup_{name}_", MaxMigrationBackupsPerSchema);

			return backupPath;
		}
		catch (Exception ex)
		{
			onWarning?.Invoke($"Failed to create migration backup: {ex.Message}");
			return null;
		}
	}

	// ─────────────────────────────────────────────────────────────
	//  2. Save-triggered history (called every time user saves .gh)
	// ─────────────────────────────────────────────────────────────

	/// <summary>
	///   Appends a history entry to the schema history file for this document.
	///   History is stored as a JSON array (newest first), capped at <see cref="MaxHistoryEntries"/> entries.
	///   <paramref name="documentId"/> ties the history to a specific .gh file.
	///   <paramref name="onWarning"/> receives a warning message if saving fails (never throws).
	/// </summary>
	public static void AppendHistory(UISchema schema, Guid documentId, Action<string> onWarning = null,
		string backupDirectory = null)
	{
		if (schema == null) return;

		try
		{
			backupDirectory ??= GetBackupDirectory();
			Directory.CreateDirectory(backupDirectory);

			var historyPath = Path.Combine(backupDirectory, $"history_{documentId:N}.json");

			// Load existing history
			var history = new JArray();
			if (File.Exists(historyPath))
			{
				try { history = JArray.Parse(File.ReadAllText(historyPath)); }
				catch { history = new JArray(); }
			}

			// Build new entry
			var entry = new JObject
			{
				["savedAt"] = DateTime.UtcNow.ToString("O"),
				["schemaVersion"] = schema.SchemaVersion,
				["schemaName"] = schema.Name,
				["schemaId"] = schema.Id,
				["documentId"] = documentId.ToString("D"),
				["schema"] = JObject.FromObject(schema, JsonSerializer.Create(BackupSerializationSettings))
			};

			// Prepend (newest first) and cap
			history.Insert(0, entry);
			while (history.Count > MaxHistoryEntries)
				history.RemoveAt(history.Count - 1);

			File.WriteAllText(historyPath, history.ToString(Formatting.Indented));
		}
		catch (Exception ex)
		{
			onWarning?.Invoke($"Failed to save schema history: {ex.Message}");
		}
	}

	/// <summary>
	///   Returns the path to the history file for a given document, or null if it doesn't exist.
	/// </summary>
	public static string GetHistoryFilePath(Guid documentId, string backupDirectory = null)
	{
		backupDirectory ??= GetBackupDirectory();
		var path = Path.Combine(backupDirectory, $"history_{documentId:N}.json");
		return File.Exists(path) ? path : null;
	}

	// ─────────────────────────────────────────────────────────────
	//  Helpers
	// ─────────────────────────────────────────────────────────────

	private static void CleanupOldFiles(string directory, string prefix, int maxFiles)
	{
		try
		{
			var files = Directory.GetFiles(directory, $"{prefix}*.json");
			if (files.Length <= maxFiles) return;

			// Sort oldest first by creation time, delete the excess
			var sorted = files.OrderBy(f => File.GetCreationTimeUtc(f)).ToArray();
			for (var i = 0; i < sorted.Length - maxFiles; i++)
				File.Delete(sorted[i]);
		}
		catch
		{
			// Ignore cleanup errors
		}
	}

	private static string SanitizeFilename(string filename)
	{
		var invalidChars = Path.GetInvalidFileNameChars();
		foreach (var c in invalidChars)
			filename = filename.Replace(c, '_');
		return filename.Length > 50 ? filename.Substring(0, 50) : filename;
	}
}
