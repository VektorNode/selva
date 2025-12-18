using System;
using System.Buffers;
using System.IO;
using System.IO.Compression;

namespace Selva.Grasshopper.Features.Display.Services;

/// <summary>
///   Shared compression utilities for mesh data serialization.
/// </summary>
public static class CompressionHelper
{
	/// <summary>
	///   Compresses vertex and face data using GZip with streaming and ArrayPool for reduced allocations.
	/// </summary>
	/// <param name="vertices">Array of vertex coordinates (x, y, z floats).</param>
	/// <param name="faces">Array of face indices.</param>
	/// <returns>Compressed binary data.</returns>
	public static byte[] CompressGeometryData(float[] vertices, int[] faces)
	{
		using (var outputStream = new MemoryStream())
		{
			// Stream compression directly - compress while writing
			using (var compressionStream = new GZipStream(outputStream, CompressionLevel.Fastest))
			using (var writer = new BinaryWriter(compressionStream))
			{
				// Write vertex count
				writer.Write(vertices.Length);

				// Write vertices using ArrayPool for reduced allocations
				WriteFloatArray(compressionStream, vertices);

				// Write face count
				writer.Write(faces.Length);

				// Write faces using ArrayPool for reduced allocations
				WriteIntArray(compressionStream, faces);
			}

			return outputStream.ToArray();
		}
	}


	/// <summary>
	///   Writes a float array to a stream using ArrayPool to minimize allocations.
	/// </summary>
	private static void WriteFloatArray(Stream stream, float[] data)
	{
		var byteCount = data.Length * sizeof(float);
		var buffer = ArrayPool<byte>.Shared.Rent(byteCount);
		try
		{
			Buffer.BlockCopy(data, 0, buffer, 0, byteCount);
			stream.Write(buffer, 0, byteCount);
		}
		finally
		{
			ArrayPool<byte>.Shared.Return(buffer);
		}
	}

	/// <summary>
	///   Writes an int array to a stream using ArrayPool to minimize allocations.
	/// </summary>
	private static void WriteIntArray(Stream stream, int[] data)
	{
		var byteCount = data.Length * sizeof(int);
		var buffer = ArrayPool<byte>.Shared.Rent(byteCount);
		try
		{
			Buffer.BlockCopy(data, 0, buffer, 0, byteCount);
			stream.Write(buffer, 0, byteCount);
		}
		finally
		{
			ArrayPool<byte>.Shared.Return(buffer);
		}
	}
}
