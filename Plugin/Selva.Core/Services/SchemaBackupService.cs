using System;
using System.IO;
using Newtonsoft.Json;
using Selva.Core.Models;

namespace Selva.Core.Services;

/// <summary>
///   Handles automatic backups of schemas before migration
/// </summary>
public static class SchemaBackupService
{
	private static readonly JsonSerializerSettings BackupSerializationSettings = new()
	{
		Formatting = Formatting.Indented,
		NullValueHandling = NullValueHandling.Ignore
	};

	/// <summary>
	///   Creates a backup of the schema in the plugin folder before migration.
	///   Backup filename format: schema_backup_v{version}_{timestamp}.json
	/// </summary>
	/// <param name="schema">The schema to backup</param>
	/// <param name="backupDirectory">Directory to save the backup (defaults to user's plugin folder)</param>
	/// <returns>Path to the created backup file, or null if backup failed</returns>
	public static string CreateBackup(UISchema schema, string backupDirectory = null)
	{
		if (schema == null) return null;

		try
		{
			// Default to plugin backups folder in user's AppData
			if (string.IsNullOrEmpty(backupDirectory))
			{
				var appData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
				backupDirectory = Path.Combine(appData, "Grasshopper", "Selva", "SchemaBackups");
			}

			// Ensure directory exists
			Directory.CreateDirectory(backupDirectory);

			// Generate backup filename
			var version = schema.SchemaVersion ?? "unknown";
			var timestamp = DateTime.UtcNow.ToString("yyyyMMdd_HHmmss");
			var name = SanitizeFilename(schema.Name ?? schema.Id ?? "untitled");
			var filename = $"schema_backup_{name}_v{version}_{timestamp}.json";
			var backupPath = Path.Combine(backupDirectory, filename);

			// Serialize and save
			var json = JsonConvert.SerializeObject(schema, BackupSerializationSettings);
			File.WriteAllText(backupPath, json);

			// Clean up old backups (keep last 10 per schema)
			CleanupOldBackups(backupDirectory, name, maxBackups: 10);

			return backupPath;
		}
		catch (Exception ex)
		{
			// Don't fail migration if backup fails - just log the error
			Console.Error.WriteLine($"Failed to create schema backup: {ex.Message}");
			return null;
		}
	}

	/// <summary>
	///   Removes old backup files, keeping only the most recent N backups for a given schema
	/// </summary>
	private static void CleanupOldBackups(string directory, string schemaName, int maxBackups)
	{
		try
		{
			var searchPattern = $"schema_backup_{schemaName}_*.json";
			var backupFiles = Directory.GetFiles(directory, searchPattern);

			if (backupFiles.Length <= maxBackups) return;

			// Sort by creation time, oldest first
			Array.Sort(backupFiles, (a, b) =>
				File.GetCreationTimeUtc(a).CompareTo(File.GetCreationTimeUtc(b))
			);

			// Delete oldest files, keeping the most recent maxBackups
			var filesToDelete = backupFiles.Length - maxBackups;
			for (var i = 0; i < filesToDelete; i++)
			{
				File.Delete(backupFiles[i]);
			}
		}
		catch
		{
			// Ignore cleanup errors
		}
	}

	/// <summary>
	///   Sanitizes a string to be safe for use as a filename
	/// </summary>
	private static string SanitizeFilename(string filename)
	{
		var invalidChars = Path.GetInvalidFileNameChars();
		foreach (var c in invalidChars)
		{
			filename = filename.Replace(c, '_');
		}
		return filename.Length > 50 ? filename.Substring(0, 50) : filename;
	}
}
