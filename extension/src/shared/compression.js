// ─── Compression utilities ──────────────────────────────────────────────

/**
 * Compress string data with gzip
 * @param {string} data
 * @returns {Promise<Blob>}
 */
export async function compressGzip(data) {
  const encoder = new TextEncoder();
  const uint8 = encoder.encode(data);

  // Use CompressionStream API (available in Chrome 80+)
  const cs = new CompressionStream('gzip');
  const writer = cs.writable.getWriter();
  writer.write(uint8);
  writer.close();

  return new Response(cs.readable).blob();
}

/**
 * Decompress gzipped data
 * @param {ArrayBuffer} buffer
 * @returns {Promise<string>}
 */
export async function decompressGzip(buffer) {
  const ds = new DecompressionStream('gzip');
  const writer = ds.writable.getWriter();
  writer.write(new Uint8Array(buffer));
  writer.close();

  const blob = new Response(ds.readable).blob();
  return (await blob).text();
}

/**
 * Convert Blob to base64 string
 * @param {Blob} blob
 * @returns {Promise<string>}
 */
export function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(/** @type {string} */(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}