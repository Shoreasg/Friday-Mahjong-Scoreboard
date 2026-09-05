const MAX_SOURCE_BYTES = 20 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
const SUPPORTED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function decodedBase64Bytes(base64: string): number {
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

export async function prepareImage(
  file: File,
  maxDimension = 1600,
): Promise<{ base64: string; mimeType: "image/jpeg" }> {
  return new Promise((resolve, reject) => {
    if (!SUPPORTED_IMAGE_TYPES.has(file.type)) {
      reject(new Error("Invalid image format. Please use JPEG, PNG, or WebP."));
      return;
    }

    if (file.size === 0) {
      reject(new Error("This image is empty. Please take another photo."));
      return;
    }

    if (file.size > MAX_SOURCE_BYTES) {
      reject(new Error("Image is too large. Please use a photo under 20 MB."));
      return;
    }

    const img = new Image();
    const url = URL.createObjectURL(file);
    const cleanup = () => URL.revokeObjectURL(url);

    img.onload = () => {
      cleanup();

      try {
        let width = img.width;
        let height = img.height;

        if (width < 1 || height < 1) {
          reject(new Error("This image has invalid dimensions. Please take another photo."));
          return;
        }

        if (width > maxDimension || height > maxDimension) {
          if (width > height) {
            height = Math.round((height * maxDimension) / width);
            width = maxDimension;
          } else {
            width = Math.round((width * maxDimension) / height);
            height = maxDimension;
          }
        }

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("Your browser could not prepare this photo. Try another browser."));
          return;
        }

        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);

        for (const quality of [0.82, 0.72, 0.62]) {
          const dataUrl = canvas.toDataURL("image/jpeg", quality);
          const base64Index = dataUrl.indexOf(";base64,");
          if (base64Index === -1) continue;

          const base64 = dataUrl.substring(base64Index + 8);
          if (decodedBase64Bytes(base64) <= MAX_OUTPUT_BYTES) {
            resolve({ base64, mimeType: "image/jpeg" });
            return;
          }
        }

        reject(new Error("This photo is still too large after compression. Please retake it."));
      } catch (err) {
        reject(
          err instanceof Error
            ? err
            : new Error("Your browser could not prepare this photo."),
        );
      }
    };

    img.onerror = () => {
      cleanup();
      reject(new Error("This photo could not be opened. Please take another photo."));
    };

    img.src = url;
  });
}
