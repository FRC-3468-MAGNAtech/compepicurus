// Client-side photo compression: phone photos are 3-12 MB, a 1600 px JPEG is a few hundred KB. Browser only.

export const DEFAULT_MAX_DIMENSION = 1600;
export const DEFAULT_JPEG_QUALITY = 0.82;

/** Why compression gave up. The caller can still upload `original` (if its type is allowed) or tell the user. */
export class CompressError extends Error {
  readonly code: "server" | "decode-failed" | "encode-failed";
  readonly original: File | Blob;
  constructor(code: CompressError["code"], message: string, original: File | Blob) {
    super(message);
    this.name = "CompressError";
    this.code = code;
    this.original = original;
  }
}

/** Scales (width, height) down to fit inside max x max. Never upscales, keeps the aspect ratio, rounds, and returns 0x0 for unusable input. */
export function fitWithin(width: number, height: number, max = DEFAULT_MAX_DIMENSION): { width: number; height: number } {
  if (!Number.isFinite(width) || !Number.isFinite(height) || !Number.isFinite(max) || width <= 0 || height <= 0 || max <= 0) return { width: 0, height: 0 };
  const scale = Math.min(1, max / Math.max(width, height));
  // Math.max(1, ...) so an extreme aspect ratio can't round a side to 0.
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/**
 * Decodes (applying EXIF orientation, which `imageOrientation: "from-image"` handles for us), downscales and re-encodes as JPEG.
 * Throws CompressError when it can't, e.g. HEIC on a browser that can't decode it; `error.original` is the untouched input.
 */
export async function compressImage(file: File | Blob, options: { maxDimension?: number; quality?: number } = {}): Promise<Blob> {
  if (typeof window === "undefined" || typeof createImageBitmap !== "function") {
    throw new CompressError("server", "Image compression only runs in the browser.", file);
  }
  const { maxDimension = DEFAULT_MAX_DIMENSION, quality = DEFAULT_JPEG_QUALITY } = options;

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new CompressError("decode-failed", "This browser couldn't read that photo.", file);
  }

  try {
    const { width, height } = fitWithin(bitmap.width, bitmap.height, maxDimension);
    if (width === 0 || height === 0) throw new CompressError("decode-failed", "That photo has no size.", file);

    let blob: Blob | null;
    if (typeof OffscreenCanvas !== "undefined") {
      const canvas = new OffscreenCanvas(width, height);
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new CompressError("encode-failed", "Couldn't prepare the photo.", file);
      ctx.drawImage(bitmap, 0, 0, width, height);
      blob = await canvas.convertToBlob({ type: "image/jpeg", quality });
    } else {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new CompressError("encode-failed", "Couldn't prepare the photo.", file);
      ctx.drawImage(bitmap, 0, 0, width, height);
      blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    }
    // Some browsers hand back PNG when JPEG isn't supported by the canvas; treat that as a failure rather than upload a huge PNG.
    if (!blob || blob.type !== "image/jpeg") throw new CompressError("encode-failed", "Couldn't compress the photo.", file);
    return blob;
  } catch (err) {
    if (err instanceof CompressError) throw err;
    throw new CompressError("encode-failed", "Couldn't compress the photo.", file);
  } finally {
    bitmap.close();
  }
}
