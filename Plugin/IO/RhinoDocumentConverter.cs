using System;
using System.IO;
using System.Security.Cryptography;
using System.Threading;
using Selva.Config;
using Microsoft.Extensions.Logging;
using Rhino;

namespace Selva.IO;

public class RhinoDocumentConverter : IDisposable
{
  private readonly AppConfig.RhinoConverterOptions _options;
  private readonly SemaphoreSlim _rateLimiter;
  private readonly string _tempDirectory;
  private bool _disposed;

  public RhinoDocumentConverter(
    AppConfig.RhinoConverterOptions options = null)
  {
    _options = options ?? new AppConfig.RhinoConverterOptions();
    _rateLimiter = new SemaphoreSlim(_options.MaxConcurrentConversions, _options.MaxConcurrentConversions);
    _tempDirectory = Path.Combine(AppConfig.FileIO.TempDirectory, Guid.NewGuid().ToString());
    Directory.CreateDirectory(_tempDirectory);
  }

  public void Dispose()
  {
    if (_disposed)
    {
      return;
    }

    _rateLimiter?.Dispose();
    try
    {
      if (Directory.Exists(_tempDirectory))
      {
        Directory.Delete(_tempDirectory, true);
      }
    }
    catch (Exception ex)
    {
    }

    _disposed = true;
  }

  /// <summary>
  ///   Synchronous version - Converts a RhinoDoc to Base64 encoded string
  /// </summary>
  public string DocToBase64(RhinoDoc doc, string fileExtension)
  {
    ValidateInputs(doc, fileExtension);

    var tempPath = GenerateTempPath(fileExtension);
    if (!_rateLimiter.Wait(_options.ConversionTimeout))
    {
      throw new TimeoutException("Conversion queue timeout - too many concurrent operations");
    }

    try
    {
      var exportSuccess = doc.Export(tempPath);

      if (!exportSuccess)
      {
        throw new IOException($"Rhino Export failed for format {fileExtension}");
      }

      var fileInfo = new FileInfo(tempPath);
      if (!fileInfo.Exists)
      {
        throw new FileNotFoundException("Export succeeded but file not found", tempPath);
      }

      if (fileInfo.Length > _options.MaxFileSizeBytes)
      {
        throw new InvalidOperationException(
          $"Exported file size ({fileInfo.Length:N0} bytes) exceeds maximum allowed ({_options.MaxFileSizeBytes:N0} bytes)");
      }

      string base64Result;
      var fileBytes = File.ReadAllBytes(tempPath);
      base64Result = Convert.ToBase64String(fileBytes);

      return base64Result;
    }
    catch (Exception ex)
    {
      throw;
    }
    finally
    {
      CleanupTempFile(tempPath);
      _rateLimiter.Release();
    }
  }

  /// <summary>
  ///   Synchronous version - Converts a RhinoDoc to Base64 encoded .3dm file
  /// </summary>
  public string DocToRhinoFile(RhinoDoc doc, int version = 7)
  {
    if (doc == null)
    {
      throw new ArgumentNullException(nameof(doc));
    }

    if (version < 2 || version > 8)
    {
      throw new ArgumentException("Rhino version must be between 2 and 8", nameof(version));
    }

    var tempPath = GenerateTempPath(".3dm");

    if (!_rateLimiter.Wait(_options.ConversionTimeout))
    {
      throw new TimeoutException("Conversion queue timeout - too many concurrent operations");
    }

    try
    {
      var saveSuccess = doc.SaveAs(tempPath, version);

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
        throw new InvalidOperationException(
          $"Saved file size ({fileInfo.Length:N0} bytes) exceeds maximum allowed ({_options.MaxFileSizeBytes:N0} bytes)");
      }

      var fileBytes = File.ReadAllBytes(tempPath);
      var base64Result = Convert.ToBase64String(fileBytes);

      return base64Result;
    }
    catch (Exception ex)
    {
      throw;
    }
    finally
    {
      CleanupTempFile(tempPath);
      _rateLimiter.Release();
    }
  }

  private void ValidateInputs(RhinoDoc doc, string fileExtension)
  {
    if (doc == null)
    {
      throw new ArgumentNullException(nameof(doc));
    }

    if (string.IsNullOrWhiteSpace(fileExtension))
    {
      throw new ArgumentException("File extension cannot be null or empty", nameof(fileExtension));
    }
  }

  private string GenerateTempPath(string fileExtension)
  {
    if (!fileExtension.StartsWith("."))
    {
      fileExtension = "." + fileExtension;
    }

    var fileName = $"{Guid.NewGuid()}{fileExtension}";
    return Path.Combine(_tempDirectory, fileName);
  }

  private void CleanupTempFile(string path)
  {
    if (string.IsNullOrEmpty(path))
    {
      return;
    }

    try
    {
      if (File.Exists(path))
      {
        if (_options.SecureDelete)
        {
          var fileInfo = new FileInfo(path);
          using (var stream = fileInfo.Open(FileMode.Open, FileAccess.Write))
          {
            var buffer = new byte[AppConfig.FileIO.FileCopyBufferSizeBytes]; // 1MB chunks
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
      }
    }
    catch (Exception ex)
    {
    }
  }
}
