export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SpriteSlice {
  id: string;
  rect: Rect;
  dataUrl: string;
}

/**
 * Detects individual sprites in an image and returns their bounding boxes and data URLs.
 */
export async function detectSprites(
  imageSource: string | HTMLImageElement,
  options: {
    tolerance?: number;
    minBlobSize?: number;
    padding?: number;
  } = {}
): Promise<{ slices: SpriteSlice[]; bgRgba: [number, number, number, number] }> {
  const { tolerance = 15, minBlobSize = 10, padding = 2 } = options;

  let img: HTMLImageElement;

  if (typeof imageSource === "string") {
    img = new Image();
    img.crossOrigin = "anonymous";
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
      img.src = imageSource;
    });
  } else {
    img = imageSource;
  }

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Could not get 2d context");

  canvas.width = img.width;
  canvas.height = img.height;
  ctx.drawImage(img, 0, 0);

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  const width = canvas.width;
  const height = canvas.height;

  // Assuming top-left pixel is the background color
  const bgR = data[0];
  const bgG = data[1];
  const bgB = data[2];
  const bgA = data[3];
  
  const originalBgRgba: [number, number, number, number] = [bgR, bgG, bgB, bgA];

  const isBackground = (idx: number) => {
    const r = data[idx];
    const g = data[idx + 1];
    const b = data[idx + 2];
    const a = data[idx + 3];

    // If perfectly transparent, treat as background
    if (a === 0) return true;

    // Compare with background color with tolerance
    return (
      Math.abs(r - bgR) <= tolerance &&
      Math.abs(g - bgG) <= tolerance &&
      Math.abs(b - bgB) <= tolerance &&
      Math.abs(a - bgA) <= tolerance
    );
  };

  const visited = new Uint8Array(width * height);
  const rects: Rect[] = [];

  // Use a stack-based flood fill to avoid recursion depth issues
  const stack: number[] = [];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const pixelIndex = y * width + x;
      const dataIndex = pixelIndex * 4;

      if (visited[pixelIndex] === 0 && !isBackground(dataIndex)) {
        // Start a new blob search
        let minX = x;
        let maxX = x;
        let minY = y;
        let maxY = y;
        let blobSize = 0;

        stack.push(pixelIndex);
        visited[pixelIndex] = 1;

        while (stack.length > 0) {
          const currIdx = stack.pop()!;
          const cx = currIdx % width;
          const cy = Math.floor(currIdx / width);
          blobSize++;

          if (cx < minX) minX = cx;
          if (cx > maxX) maxX = cx;
          if (cy < minY) minY = cy;
          if (cy > maxY) maxY = cy;

          // Check neighbors (4-way connectivity)
          const neighbors = [
            { nx: cx, ny: cy - 1 }, // top
            { nx: cx, ny: cy + 1 }, // bottom
            { nx: cx - 1, ny: cy }, // left
            { nx: cx + 1, ny: cy }, // right
          ];

          for (const { nx, ny } of neighbors) {
            if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
              const nIdx = ny * width + nx;
              if (visited[nIdx] === 0) {
                const nDataIdx = nIdx * 4;
                visited[nIdx] = 1; // Mark visited early to avoid pushing duplicates to stack
                if (!isBackground(nDataIdx)) {
                  stack.push(nIdx);
                }
              }
            }
          }
        }

        if (blobSize >= minBlobSize) {
          // Add padding
          minX = Math.max(0, minX - padding);
          minY = Math.max(0, minY - padding);
          maxX = Math.min(width - 1, maxX + padding);
          maxY = Math.min(height - 1, maxY + padding);

          rects.push({
            x: minX,
            y: minY,
            w: maxX - minX + 1,
            h: maxY - minY + 1,
          });
        }
      } else {
        visited[pixelIndex] = 1; // Mark background as visited
      }
    }
  }

  // Generate data URLs for each slice
  const slices: SpriteSlice[] = [];
  
  // Create a temporary canvas for extraction
  const extractCanvas = document.createElement("canvas");
  const extractCtx = extractCanvas.getContext("2d");
  
  if (extractCtx) {
     for (let i = 0; i < rects.length; i++) {
        const rect = rects[i];
        extractCanvas.width = rect.w;
        extractCanvas.height = rect.h;
        
        // Clear canvas
        extractCtx.clearRect(0, 0, rect.w, rect.h);
        
        // Draw the specific portion of the original image
        extractCtx.drawImage(
            canvas,
            rect.x, rect.y, rect.w, rect.h, // Source
            0, 0, rect.w, rect.h           // Destination
        );
        
        // Convert to PNG with transparency (it preserves whatever was there)
        // Note: For solid backgrounds, we might want to make them transparent, 
        // but for now we just crop them.
        slices.push({
            id: `sprite_${i + 1}`,
            rect,
            dataUrl: extractCanvas.toDataURL("image/png")
        });
     }
  }

  return { slices, bgRgba: originalBgRgba };
}

/**
 * Advanced option: makes the identified background color transparent in the slices.
 */
export function removeBackgroundFromMainCanvas(
    sourceCanvas: HTMLCanvasElement, 
    bgRgba: [number, number, number, number], 
    tolerance: number = 15
): HTMLCanvasElement {
    const ctx = sourceCanvas.getContext('2d');
    if (!ctx) return sourceCanvas;
    
    const imageData = ctx.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height);
    const data = imageData.data;
    
    for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i+1];
        const b = data[i+2];
        const a = data[i+3];
        
        if (a > 0 && 
            Math.abs(r - bgRgba[0]) <= tolerance &&
            Math.abs(g - bgRgba[1]) <= tolerance &&
            Math.abs(b - bgRgba[2]) <= tolerance) {
            // Set alpha to 0 for background pixels
            data[i+3] = 0;
        }
    }
    
    ctx.putImageData(imageData, 0, 0);
    return sourceCanvas;
}
