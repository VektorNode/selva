using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using Rhino;
using Rhino.DocObjects;
using Rhino.FileIO;
using Rhino.Geometry;
using Selva.Schema.Models;
using Selva.GH.Config;

namespace Selva.GH.Features.FileIO.Services;

public static class FileImporter
{
    private static readonly int MAX_FILE_SIZE_BYTES = AppConfig.ValueLimits.MaxFileSizeBytes;

    private static readonly HttpClient UrlDownloadClient = new HttpClient
    {
        Timeout = TimeSpan.FromSeconds(60)
    };

    public static (bool Success, List<GeometryWithName> Geometry, string DetectedFormat, string ErrorMessage)
        ImportFromFileInputData(FileInputData fileData)
    {
        if (fileData == null || string.IsNullOrEmpty(fileData.File))
        {
            return (false, new List<GeometryWithName>(), "", "File data is null or empty");
        }

        string tempPath = null;
        // Only delete files we created ourselves (base64/url temp files) — never the
        // user's own file when Type is "path" or unspecified.
        var deleteAfterImport = false;
        try
        {
            switch (fileData.Type?.ToLowerInvariant())
            {
                case "base64":
                    var decodeResult = DecodeBase64ToTemp(fileData.File, fileData.FileEnding);
                    if (!decodeResult.Success)
                    {
                        return (false, new List<GeometryWithName>(), "", decodeResult.ErrorMessage);
                    }

                    tempPath = decodeResult.TempPath;
                    deleteAfterImport = true;
                    break;

                case "url":
                    var downloadResult = DownloadUrlToTemp(fileData.File, fileData.FileEnding);
                    if (!downloadResult.Success)
                    {
                        return (false, new List<GeometryWithName>(), "", downloadResult.ErrorMessage);
                    }

                    tempPath = downloadResult.TempPath;
                    deleteAfterImport = true;
                    break;

                default:
                    // "path" or unspecified — treat as a local path
                    tempPath = fileData.File;
                    break;
            }

            return ImportFile(tempPath);
        }
        finally
        {
            if (deleteAfterImport && !string.IsNullOrEmpty(tempPath) && File.Exists(tempPath))
            {
                try
                {
                    File.Delete(tempPath);
                }
                catch
                {
                    /* ignore cleanup errors */
                }
            }
        }
    }

    public static (bool Success, List<GeometryWithName> Geometry, string DetectedFormat, string ErrorMessage)
        ImportFile(string filePath)
    {
        if (string.IsNullOrEmpty(filePath))
        {
            return (false, new List<GeometryWithName>(), "", "File path is empty");
        }

        if (!File.Exists(filePath))
        {
            return (false, new List<GeometryWithName>(), "", $"File not found: {filePath}");
        }

        var fileInfo = new FileInfo(filePath);
        if (fileInfo.Length > MAX_FILE_SIZE_BYTES)
        {
            return (false, new List<GeometryWithName>(), "",
                $"File too large: {fileInfo.Length / 1024 / 1024}MB (max {MAX_FILE_SIZE_BYTES / 1024 / 1024}MB)");
        }

        var extension = Path.GetExtension(filePath).ToLowerInvariant();

        var doc = RhinoDoc.CreateHeadless(null);
        if (doc == null)
        {
            return (false, new List<GeometryWithName>(), "", "Failed to create Rhino document");
        }

        try
        {
            bool importSuccess;

            switch (extension)
            {
                case ".3dm":
                    importSuccess = Import3dm(filePath, doc);
                    break;

                case ".stp":
                case ".step":
                    importSuccess = ImportStep(filePath, doc);
                    break;

                case ".fbx":
                    importSuccess = ImportFbx(filePath, doc);
                    break;

                case ".stl":
                    importSuccess = ImportStl(filePath, doc);
                    break;

                case ".obj":
                    importSuccess = ImportObj(filePath, doc);
                    break;

                default:
                    importSuccess = ImportGeneric(filePath, doc);
                    break;
            }

            if (!importSuccess)
            {
                return (false, new List<GeometryWithName>(), extension,
                    $"Failed to import file with extension {extension}");
            }

            var geometryList = ExtractGeometryFromDocument(doc);

            return (true, geometryList, extension, "");
        }
        catch (Exception ex)
        {
            return (false, new List<GeometryWithName>(), extension, $"Import error: {ex.Message}");
        }
        finally
        {
            doc.Dispose();
        }
    }

    public static (bool Success, string TempPath, string ErrorMessage) DecodeBase64ToTemp(string base64Data,
        string fileEnding)
    {
        try
        {
            if (string.IsNullOrEmpty(base64Data))
            {
                return (false, null, "Base64 data is empty");
            }

            // Reject oversized input before decoding — base64 is ~1.37x the decoded size, so this
            // cap must exceed MAX_FILE_SIZE_BYTES or valid files get rejected here first.
            if (base64Data.Length > MAX_FILE_SIZE_BYTES * 2)
            {
                return (false, null, "Base64 data too large");
            }

            var extension = !string.IsNullOrEmpty(fileEnding) ? fileEnding : ".tmp";
            if (!IsAllowedExtension(extension, out var extensionError))
            {
                return (false, null, extensionError);
            }

            var bytes = Convert.FromBase64String(base64Data);

            if (bytes.Length > MAX_FILE_SIZE_BYTES)
            {
                return (false, null,
                    $"Decoded file too large: {bytes.Length / 1024 / 1024}MB (max {MAX_FILE_SIZE_BYTES / 1024 / 1024}MB)");
            }

            var tempPath = Path.Combine(Path.GetTempPath(), $"selva_base64_{Guid.NewGuid():N}{extension}");

            File.WriteAllBytes(tempPath, bytes);

            return (true, tempPath, "");
        }
        catch (FormatException)
        {
            return (false, null, "Invalid base64 format");
        }
        catch (Exception ex)
        {
            return (false, null, $"Base64 decode failed: {ex.Message}");
        }
    }

    /// <summary>
    ///     Downloads an http(s) URL to a temp file, enforcing the same size and extension
    ///     limits as base64 input.
    /// </summary>
    public static (bool Success, string TempPath, string ErrorMessage) DownloadUrlToTemp(string url,
        string fileEnding)
    {
        string tempPath = null;
        try
        {
            // SSRF guard: resolve the host and reject any non-public address (loopback,
            // link-local incl. cloud metadata, private ranges). On net7+ the returned IPs
            // are used to pin the connection (see CreatePinnedClient) so a rebind between
            // this check and the fetch can't redirect us to an internal host.
            if (!SafeUrlValidator.TryValidate(url, out var resolvedAddresses, out var urlError))
            {
                return (false, null, urlError);
            }

            var uri = new Uri(url);

            var extension = !string.IsNullOrEmpty(fileEnding) ? fileEnding : Path.GetExtension(uri.LocalPath);
            if (!IsAllowedExtension(extension, out var extensionError))
            {
                return (false, null, extensionError);
            }

            var (client, ownsClient) = CreatePinnedClient(resolvedAddresses);
            try
            {
                // net48 has no sync HttpClient API; blocking here is safe since HttpClient
                // internals use ConfigureAwait(false) throughout.
                using var response = client
                    .GetAsync(uri, HttpCompletionOption.ResponseHeadersRead)
                    .GetAwaiter().GetResult();

                if (!response.IsSuccessStatusCode)
                {
                    return (false, null, $"Download failed: HTTP {(int)response.StatusCode}");
                }

                if (response.Content.Headers.ContentLength > MAX_FILE_SIZE_BYTES)
                {
                    return (false, null,
                        $"Downloaded file too large (max {MAX_FILE_SIZE_BYTES / 1024 / 1024}MB)");
                }

                tempPath = Path.Combine(Path.GetTempPath(),
                    $"selva_url_{Guid.NewGuid():N}{extension.ToLowerInvariant()}");

                using (var source = response.Content.ReadAsStreamAsync().GetAwaiter().GetResult())
                using (var destination = File.Create(tempPath))
                {
                    // Manual copy so the size cap holds even when Content-Length is absent or wrong.
                    var buffer = new byte[81920];
                    long total = 0;
                    int read;
                    while ((read = source.Read(buffer, 0, buffer.Length)) > 0)
                    {
                        total += read;
                        if (total > MAX_FILE_SIZE_BYTES)
                        {
                            return (false, null,
                                $"Downloaded file too large (max {MAX_FILE_SIZE_BYTES / 1024 / 1024}MB)");
                        }

                        destination.Write(buffer, 0, read);
                    }
                }

                var result = (true, tempPath, "");
                tempPath = null; // success — caller owns the file now
                return result;
            }
            finally
            {
                if (ownsClient) client.Dispose();
            }
        }
        catch (Exception ex)
        {
            return (false, null, $"Download failed: {ex.Message}");
        }
        finally
        {
            // Clean up a partially-written temp file on any failure path.
            if (tempPath != null && File.Exists(tempPath))
            {
                try { File.Delete(tempPath); } catch { /* ignore cleanup errors */ }
            }
        }
    }

    /// <summary>
    ///     On net7+ pins outgoing connections to the already-validated IPs, so a DNS rebind
    ///     between validation and fetch can't redirect the request to an internal host. net48
    ///     has no ConnectCallback, so it falls back to the shared client with a narrow rebind window.
    /// </summary>
    private static (HttpClient client, bool ownsClient) CreatePinnedClient(IPAddress[] resolvedAddresses)
    {
#if NET7_0_OR_GREATER
        var allowed = new HashSet<IPAddress>(resolvedAddresses);
        var handler = new SocketsHttpHandler
        {
            ConnectCallback = async (context, cancellationToken) =>
            {
                // Resolve again at connect time, but only allow IPs that passed validation.
                // Anything else (a rebind to an internal address) is refused.
                var target = context.DnsEndPoint;
                if (IPAddress.TryParse(target.Host, out var literal))
                {
                    if (!allowed.Contains(literal))
                        throw new HttpRequestException("Host resolved to a disallowed address");
                    return await OpenSocket(literal, target.Port, cancellationToken).ConfigureAwait(false);
                }

                var current = await Dns.GetHostAddressesAsync(target.Host, cancellationToken).ConfigureAwait(false);
                var pinned = current.FirstOrDefault(ip => allowed.Contains(ip) && SafeUrlValidator.IsPublic(ip));
                if (pinned == null)
                    throw new HttpRequestException("Host resolved to a disallowed address");

                return await OpenSocket(pinned, target.Port, cancellationToken).ConfigureAwait(false);
            }
        };

        return (new HttpClient(handler) { Timeout = TimeSpan.FromSeconds(60) }, true);
#else
        return (UrlDownloadClient, false);
#endif
    }

#if NET7_0_OR_GREATER
    private static async System.Threading.Tasks.Task<Stream> OpenSocket(
        IPAddress address, int port, System.Threading.CancellationToken cancellationToken)
    {
        var socket = new System.Net.Sockets.Socket(
            System.Net.Sockets.SocketType.Stream, System.Net.Sockets.ProtocolType.Tcp) { NoDelay = true };
        try
        {
            await socket.ConnectAsync(new IPEndPoint(address, port), cancellationToken).ConfigureAwait(false);
            return new System.Net.Sockets.NetworkStream(socket, ownsSocket: true);
        }
        catch
        {
            socket.Dispose();
            throw;
        }
    }
#endif

    /// <summary>
    ///     Checks the extension against the schema-driven allowlist and rejects path-traversal characters.
    /// </summary>
    private static bool IsAllowedExtension(string extension, out string errorMessage)
    {
        if (string.IsNullOrEmpty(extension))
        {
            errorMessage = "File extension is missing";
            return false;
        }

        if (extension.Contains("..") || extension.Contains("/") || extension.Contains("\\"))
        {
            errorMessage = "Invalid file extension";
            return false;
        }

        if (!AcceptedFileFormats.Values.Any(ext =>
                ext.Equals(extension, StringComparison.OrdinalIgnoreCase)))
        {
            errorMessage = $"File extension '{extension}' is not supported";
            return false;
        }

        errorMessage = "";
        return true;
    }

    private static bool Import3dm(string filePath, RhinoDoc doc)
    {
        try
        {
            return doc.Import(filePath);
        }
        catch
        {
            return false;
        }
    }

    private static bool ImportStep(string filePath, RhinoDoc doc)
    {
        try
        {
            var options = new FileStpReadOptions();
            return FileStp.Read(filePath, doc, options);
        }
        catch
        {
            return false;
        }
    }


    private static bool ImportFbx(string filePath, RhinoDoc doc)
    {
        try
        {
            var options = new FileFbxReadOptions();
            return FileFbx.Read(filePath, doc, options);
        }
        catch
        {
            return false;
        }
    }

    private static bool ImportStl(string filePath, RhinoDoc doc)
    {
        try
        {
            var options = new FileStlReadOptions();
            return FileStl.Read(filePath, doc, options);
        }
        catch
        {
            return false;
        }
    }

    private static bool ImportObj(string filePath, RhinoDoc doc)
    {
        try
        {
            using (var fileReadOptions = new FileReadOptions())
            {
                var options = new FileObjReadOptions(fileReadOptions);
                return FileObj.Read(filePath, doc, options);
            }
        }
        catch
        {
            return false;
        }
    }

    private static bool ImportGeneric(string filePath, RhinoDoc doc)
    {
        try
        {
            return doc.Import(filePath);
        }
        catch
        {
            return false;
        }
    }

    private static List<GeometryWithName> ExtractGeometryFromDocument(RhinoDoc doc)
    {
        var geometryList = new List<GeometryWithName>();

        foreach (var obj in doc.Objects)
        {
            var layerIndex = obj.Attributes.LayerIndex;
            var layerName = layerIndex >= 0 && layerIndex < doc.Layers.Count
                ? doc.Layers[layerIndex].Name
                : "";

            if (obj.Geometry.ObjectType == ObjectType.InstanceReference)
            {
                var instanceGeo = obj.Geometry as InstanceReferenceGeometry;
                if (instanceGeo != null)
                {
                    var idef = doc.InstanceDefinitions.FindId(instanceGeo.ParentIdefId);
                    var blockName = idef?.Name ?? "Unknown Block";

                    var blockGeometry = ExplodeInstanceRecursive(doc, instanceGeo, Transform.Identity, blockName);
                    geometryList.AddRange(blockGeometry);
                }
            }
            else
            {
                var geo = obj.Geometry.Duplicate();
                if (geo != null)
                {
                    geometryList.Add(new GeometryWithName(geo, "No Block", layerName));
                }
            }
        }

        return geometryList;
    }

    /// <summary>
    ///     Recursively flattens nested block instances into world-space geometry, composing
    ///     transforms down the hierarchy and naming each piece "Outer::Inner".
    /// </summary>
    private static List<GeometryWithName> ExplodeInstanceRecursive(RhinoDoc doc,
        InstanceReferenceGeometry instanceRef,
        Transform parentTransform, string parentBlockName)
    {
        var geometryList = new List<GeometryWithName>();

        var idef = doc.InstanceDefinitions.FindId(instanceRef.ParentIdefId);
        if (idef == null)
        {
            return geometryList;
        }

        var combinedTransform = parentTransform * instanceRef.Xform;

        var currentBlockName = idef.Name;
        if (!string.IsNullOrEmpty(parentBlockName) && parentBlockName != "No Block")
        {
            currentBlockName = $"{parentBlockName}::{currentBlockName}";
        }

        var defObjects = idef.GetObjects();

        foreach (var obj in defObjects)
        {
            if (obj == null)
            {
                continue;
            }

            if (obj.Geometry.ObjectType == ObjectType.InstanceReference)
            {
                if (obj.Geometry is InstanceReferenceGeometry nestedInstanceGeo)
                {
                    var nestedGeometry =
                        ExplodeInstanceRecursive(doc, nestedInstanceGeo, combinedTransform, currentBlockName);
                    geometryList.AddRange(nestedGeometry);
                }
            }
            else
            {
                var layerIndex = obj.Attributes.LayerIndex;
                var layerName = layerIndex >= 0 && layerIndex < doc.Layers.Count
                    ? doc.Layers[layerIndex].Name
                    : "";
                var geo = obj.Geometry.Duplicate();

                if (geo != null)
                {
                    if (!combinedTransform.Equals(Transform.Identity))
                    {
                        if (combinedTransform.SimilarityType == TransformSimilarityType.NotSimilarity)
                        {
                            if (!geo.MakeDeformable() && geo.ObjectType == ObjectType.Curve)
                            {
                                if (geo is Curve crv)
                                {
                                    geo = crv.ToNurbsCurve();
                                }
                            }
                        }

                        var transformSuccess = geo.Transform(combinedTransform);
                        if (!transformSuccess)
                        {
                            geo.Dispose();
                            continue;
                        }

                        if (combinedTransform.SimilarityType == TransformSimilarityType.OrientationReversing)
                        {
                            if (geo.ObjectType == ObjectType.Brep && geo is Brep brep)
                            {
                                brep.Flip();
                            }
                            else if (geo.ObjectType == ObjectType.Mesh && geo is Mesh mesh)
                            {
                                mesh.Flip(true, true, true);
                            }
                        }
                    }

                    geometryList.Add(new GeometryWithName(geo, currentBlockName, layerName));
                }
            }
        }

        return geometryList;
    }

    public class GeometryWithName
    {
        public GeometryWithName(GeometryBase geometry, string blockName, string layerName = "")
        {
            Geometry = geometry;
            BlockName = blockName;
            LayerName = layerName;
        }

        public GeometryBase Geometry { get; set; }
        public string BlockName { get; set; }
        public string LayerName { get; set; }
    }
}
