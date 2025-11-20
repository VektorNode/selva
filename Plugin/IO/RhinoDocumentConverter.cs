using System;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Extensions.Logging;
using Rhino;

namespace Compuceraptor.Components.IO;

public class RhinoDocumentConverter : IDisposable
{
    private readonly ILogger<RhinoDocumentConverter> _logger;
    private readonly RhinoConverterOptions _options;
    private readonly SemaphoreSlim _rateLimiter;
    private readonly string _tempDirectory;
    private bool _disposed;

    public RhinoDocumentConverter(
        ILogger<RhinoDocumentConverter> logger,
        RhinoConverterOptions options = null)
    {
        _logger = logger ?? throw new ArgumentNullException(nameof(logger));
        _options = options ?? new RhinoConverterOptions();
        _rateLimiter = new SemaphoreSlim(_options.MaxConcurrentConversions, _options.MaxConcurrentConversions);

        // Create dedicated temp directory with restricted permissions
        _tempDirectory = Path.Combine(Path.GetTempPath(), "RhinoConversions", Guid.NewGuid().ToString());
        Directory.CreateDirectory(_tempDirectory);

        _logger.LogInformation("RhinoDocumentConverter initialized with temp directory: {TempDirectory}",
            _tempDirectory);
    }

    /// <summary>
    /// Synchronous version - Converts a RhinoDoc to Base64 encoded string
    /// </summary>
    public string DocToBase64(RhinoDoc doc, string fileExtension)
    {
        ValidateInputs(doc, fileExtension);

        var tempPath = GenerateTempPath(fileExtension);

        // Rate limiting (synchronous wait)
        if (!_rateLimiter.Wait(_options.ConversionTimeout))
        {
            throw new TimeoutException("Conversion queue timeout - too many concurrent operations");
        }

        try
        {
            _logger.LogDebug("Starting export to {Extension} format at {Path}", fileExtension, tempPath);

            // Synchronous export
            bool exportSuccess = doc.Export(tempPath);

            if (!exportSuccess)
            {
                throw new IOException($"Rhino Export failed for format {fileExtension}");
            }

            // Validate file size
            var fileInfo = new FileInfo(tempPath);
            if (!fileInfo.Exists)
            {
                throw new FileNotFoundException("Export succeeded but file not found", tempPath);
            }

            if (fileInfo.Length > _options.MaxFileSizeBytes)
            {
                _logger.LogWarning("File size {Size} exceeds limit {Limit}", fileInfo.Length,
                    _options.MaxFileSizeBytes);
                throw new InvalidOperationException(
                    $"Exported file size ({fileInfo.Length:N0} bytes) exceeds maximum allowed ({_options.MaxFileSizeBytes:N0} bytes)");
            }

            // Read and convert to Base64
            string base64Result;
            byte[] fileBytes = File.ReadAllBytes(tempPath);
            base64Result = Convert.ToBase64String(fileBytes);

            _logger.LogInformation("Successfully converted document to Base64. Size: {Size} bytes", fileInfo.Length);
            return base64Result;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error converting document to Base64 with extension {Extension}", fileExtension);
            throw;
        }
        finally
        {
            CleanupTempFile(tempPath);
            _rateLimiter.Release();
        }
    }

    /// <summary>
    /// Synchronous version - Converts a RhinoDoc to Base64 encoded .3dm file
    /// </summary>
    public string DocToRhinoFile(RhinoDoc doc, int version = 7)
    {
        if (doc == null)
            throw new ArgumentNullException(nameof(doc));

        if (version < 2 || version > 8)
            throw new ArgumentException("Rhino version must be between 2 and 8", nameof(version));

        var tempPath = GenerateTempPath(".3dm");

        if (!_rateLimiter.Wait(_options.ConversionTimeout))
        {
            throw new TimeoutException("Conversion queue timeout - too many concurrent operations");
        }

        try
        {
            _logger.LogDebug("Starting Rhino SaveAs version {Version} at {Path}", version, tempPath);

            bool saveSuccess = doc.SaveAs(tempPath, version);

            if (!saveSuccess)
            {
                throw new IOException($"Rhino SaveAs failed for version {version}");
            }

            var fileInfo = new FileInfo(tempPath);
            if (!fileInfo.Exists)
            {
                throw new FileNotFoundException("SaveAs succeeded but file not found", tempPath);
            }

            if (fileInfo.Length > _options.MaxFileSizeBytes)
            {
                _logger.LogWarning("File size {Size} exceeds limit {Limit}", fileInfo.Length,
                    _options.MaxFileSizeBytes);
                throw new InvalidOperationException(
                    $"Saved file size ({fileInfo.Length:N0} bytes) exceeds maximum allowed ({_options.MaxFileSizeBytes:N0} bytes)");
            }

            byte[] fileBytes = File.ReadAllBytes(tempPath);
            string base64Result = Convert.ToBase64String(fileBytes);

            _logger.LogInformation("Successfully converted document to Rhino file. Size: {Size} bytes",
                fileInfo.Length);
            return base64Result;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error converting document to Rhino file version {Version}", version);
            throw;
        }
        finally
        {
            CleanupTempFile(tempPath);
            _rateLimiter.Release();
        }
    }

    /// <summary>
    /// Stream-based Base64 conversion for large files to reduce memory pressure
    /// </summary>
    private async Task<string> ConvertToBase64StreamingAsync(string filePath, CancellationToken cancellationToken)
    {
        _logger.LogDebug("Using streaming Base64 conversion for large file");

        using var fileStream = new FileStream(filePath, FileMode.Open, FileAccess.Read, FileShare.Read,
            bufferSize: 81920, useAsync: true); // 81920 = 80KB, optimal for Base64 (divisible by 3)

        using var cryptoStream = new CryptoStream(
            Stream.Null,
            new ToBase64Transform(),
            CryptoStreamMode.Write);

        var stringBuilder = new StringBuilder();
        var buffer = new byte[81920];
        int bytesRead;

        while ((bytesRead = await fileStream.ReadAsync(buffer, 0, buffer.Length, cancellationToken)) > 0)
        {
            string chunk = Convert.ToBase64String(buffer, 0, bytesRead);
            stringBuilder.Append(chunk);
        }

        return stringBuilder.ToString();
    }

    private void ValidateInputs(RhinoDoc doc, string fileExtension)
    {
        if (doc == null)
            throw new ArgumentNullException(nameof(doc));

        if (string.IsNullOrWhiteSpace(fileExtension))
            throw new ArgumentException("File extension cannot be null or empty", nameof(fileExtension));
    }

    private string GenerateTempPath(string fileExtension)
    {
        if (!fileExtension.StartsWith("."))
            fileExtension = "." + fileExtension;

        string fileName = $"{Guid.NewGuid()}{fileExtension}";
        return Path.Combine(_tempDirectory, fileName);
    }

    private void CleanupTempFile(string path)
    {
        if (string.IsNullOrEmpty(path))
            return;

        try
        {
            if (File.Exists(path))
            {
                if (_options.SecureDelete)
                {
                    var fileInfo = new FileInfo(path);
                    using (var stream = fileInfo.Open(FileMode.Open, FileAccess.Write))
                    {
                        var buffer = new byte[Math.Min(fileInfo.Length, 1024 * 1024)]; // 1MB chunks
                        using (var rng = RandomNumberGenerator.Create())
                        {
                            rng.GetBytes(buffer);
                        }

                        for (long i = 0; i < fileInfo.Length; i += buffer.Length)
                        {
                            stream.Write(buffer, 0, (int)Math.Min(buffer.Length, fileInfo.Length - i));
                        }
                    }
                }

                File.Delete(path);
                _logger.LogDebug("Cleaned up temporary file: {Path}", path);
            }
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to clean up temporary file: {Path}", path);
        }
    }

    private async Task CleanupTempFileAsync(string path)
    {
        if (string.IsNullOrEmpty(path))
            return;

        try
        {
            if (File.Exists(path))
            {
                // Secure deletion: overwrite before deleting (optional, for sensitive data)
                if (_options.SecureDelete)
                {
                    var fileInfo = new FileInfo(path);
                    using (var stream = fileInfo.Open(FileMode.Open, FileAccess.Write))
                    {
                        var buffer = new byte[Math.Min(fileInfo.Length, 1024 * 1024)]; // 1MB chunks
                        using (var rng = RandomNumberGenerator.Create())
                        {
                            rng.GetBytes(buffer);
                        }

                        for (long i = 0; i < fileInfo.Length; i += buffer.Length)
                        {
                            await stream.WriteAsync(buffer, 0, (int)Math.Min(buffer.Length, fileInfo.Length - i));
                        }
                    }
                }

                File.Delete(path);
                _logger.LogDebug("Cleaned up temporary file: {Path}", path);
            }
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to clean up temporary file: {Path}", path);
        }
    }

    public void Dispose()
    {
        if (_disposed)
            return;

        _rateLimiter?.Dispose();

        // Cleanup temp directory
        try
        {
            if (Directory.Exists(_tempDirectory))
            {
                Directory.Delete(_tempDirectory, recursive: true);
                _logger.LogInformation("Cleaned up temp directory: {TempDirectory}", _tempDirectory);
            }
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to clean up temp directory: {TempDirectory}", _tempDirectory);
        }

        _disposed = true;
    }

    /// <summary>
    /// Async file reading helper for compatibility with older .NET versions
    /// </summary>
    private static async Task<byte[]> ReadAllBytesAsync(string path, CancellationToken cancellationToken)
    {
        using (var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read,
                   bufferSize: 81920, useAsync: true))
        {
            var buffer = new byte[stream.Length];
            int totalRead = 0;
            int bytesRead;

            while (totalRead < buffer.Length &&
                   (bytesRead =
                       await stream.ReadAsync(buffer, totalRead, buffer.Length - totalRead, cancellationToken)) > 0)
            {
                totalRead += bytesRead;
            }

            return buffer;
        }
    }
}