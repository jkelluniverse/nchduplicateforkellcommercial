/** Overlay the property address + capture timestamp onto a photo (proof of
 *  service). Returns a JPEG data URL. */
export function stampPhoto(imageDataUrl: string, address: string, timestamp: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) { reject(new Error("Canvas not available")); return; }

      ctx.drawImage(img, 0, 0);

      const fontSize = Math.max(img.width * 0.035, 24);
      ctx.font = `bold ${fontSize}px Arial`;
      const addressWidth = ctx.measureText(address).width;
      const timeWidth = ctx.measureText(timestamp).width;
      const maxWidth = Math.max(addressWidth, timeWidth) + 40;
      const barHeight = fontSize * 2.8;
      const padding = 20;

      ctx.fillStyle = "rgba(0, 0, 0, 0.65)";
      ctx.fillRect(padding, img.height - barHeight - padding, maxWidth, barHeight);

      ctx.fillStyle = "#FFFFFF";
      ctx.font = `${fontSize * 0.75}px Arial`;
      ctx.fillText(address, padding + 10, img.height - barHeight - padding + fontSize * 0.9);

      ctx.fillStyle = "#FFFFFF";
      ctx.font = `bold ${fontSize}px Arial`;
      ctx.fillText(timestamp, padding + 10, img.height - padding - 12);

      resolve(canvas.toDataURL("image/jpeg", 0.92));
    };
    img.onerror = () => reject(new Error("Could not load image"));
    img.src = imageDataUrl;
  });
}

export function proofTimestamp(d = new Date()): string {
  return (
    d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) +
    "  " +
    d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })
  );
}

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

/** Public Drive image URLs (files are shared anyone-with-link on upload). */
export const driveThumb = (fileId: string, w = 400) => `https://drive.google.com/thumbnail?id=${fileId}&sz=w${w}`;
export const driveFull = (fileId: string) => `https://drive.google.com/uc?export=view&id=${fileId}`;
