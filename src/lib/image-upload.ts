export const IMAGE_UPLOAD_MAX_BYTES = 2 * 1024 * 1024;
export const IMAGE_UPLOAD_MIMES = new Set(["image/jpeg", "image/png", "image/webp"]);

export function parseUploadedImageBuffer(args: {
  imageBase64: string;
  mimeType: string;
}): Buffer {
  if (!IMAGE_UPLOAD_MIMES.has(args.mimeType)) {
    throw new Error("Formato no permitido. Usa JPEG, PNG o WebP.");
  }

  const buffer = Buffer.from(args.imageBase64, "base64");
  if (buffer.length === 0) throw new Error("La imagen está vacía.");
  if (buffer.length > IMAGE_UPLOAD_MAX_BYTES) {
    throw new Error("La imagen supera el máximo de 2 MB.");
  }

  return buffer;
}
