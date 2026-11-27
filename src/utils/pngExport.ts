import { toPng } from 'html-to-image';

export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Captures the React Flow canvas container as a high-resolution PNG Blob,
 * supporting an independent Dark/Light theme override and optional rectangular crop region.
 */
export async function captureCanvasToPngBlob(options: {
  container: HTMLElement;
  exportTheme: 'dark' | 'light';
  cropRect?: CropRect | null;
  pixelRatio?: number;
}): Promise<Blob> {
  const { container, exportTheme, cropRect, pixelRatio = 2 } = options;

  const rootEl = document.documentElement;
  const previousTheme = rootEl.getAttribute('data-theme') || 'dark';
  const previousDarkClass = rootEl.classList.contains('dark');
  const needsSwitch = previousTheme !== exportTheme;

  if (needsSwitch) {
    rootEl.setAttribute('data-theme', exportTheme);
    if (exportTheme === 'dark') rootEl.classList.add('dark');
    else rootEl.classList.remove('dark');
    // Allow CSS repaint
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  }

  let dataUrl: string;
  try {
    dataUrl = await toPng(container, {
      pixelRatio,
      backgroundColor: exportTheme === 'light' ? '#f8fafc' : '#020617',
      filter: (node) => {
        if (!(node instanceof HTMLElement)) return true;
        // Hide controls, minimap, and crop overlay from exported image
        if (
          node.classList.contains('react-flow__controls') ||
          node.classList.contains('react-flow__minimap') ||
          node.dataset.exportIgnore === 'true'
        ) {
          return false;
        }
        return true;
      },
    });
  } finally {
    if (needsSwitch) {
      rootEl.setAttribute('data-theme', previousTheme);
      if (previousDarkClass) rootEl.classList.add('dark');
      else rootEl.classList.remove('dark');
    }
  }

  if (!cropRect || cropRect.width < 10 || cropRect.height < 10) {
    const res = await fetch(dataUrl);
    return await res.blob();
  }

  // Crop high-res image to selected rectangle
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('Impossible de décoder la capture PNG.'));
    img.src = dataUrl;
  });

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(cropRect.width * pixelRatio);
  canvas.height = Math.round(cropRect.height * pixelRatio);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Contexte Canvas 2D indisponible.');

  ctx.drawImage(
    img,
    Math.round(cropRect.x * pixelRatio),
    Math.round(cropRect.y * pixelRatio),
    Math.round(cropRect.width * pixelRatio),
    Math.round(cropRect.height * pixelRatio),
    0,
    0,
    canvas.width,
    canvas.height
  );

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Échec de génération du fichier PNG.'));
    }, 'image/png');
  });
}
