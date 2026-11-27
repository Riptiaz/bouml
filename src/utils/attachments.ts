export interface AiAttachment {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  /** Native multimodal base64 payload (images, PDFs) sent directly as inlineData to Gemini */
  base64Data?: string;
  /** Preview data URL for image thumbnails */
  previewUrl?: string;
  /** Plain text payload for .txt, .md, .docx extracted text */
  textContent?: string;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

/**
 * Lightweight zero-dependency DOCX XML text extractor using browser DecompressionStream.
 * Falls back cleanly to readable ASCII/UTF-8 extraction if not available.
 */
async function extractDocxText(buffer: ArrayBuffer): Promise<string> {
  try {
    const view = new DataView(buffer);
    const bytes = new Uint8Array(buffer);
    // Scan ZIP local file headers (PK\x03\x04) for word/document.xml
    let offset = 0;
    while (offset + 30 < bytes.length) {
      if (
        bytes[offset] === 0x50 &&
        bytes[offset + 1] === 0x4b &&
        bytes[offset + 2] === 0x03 &&
        bytes[offset + 3] === 0x04
      ) {
        const compression = view.getUint16(offset + 8, true);
        const compressedSize = view.getUint32(offset + 18, true);
        const nameLen = view.getUint16(offset + 26, true);
        const extraLen = view.getUint16(offset + 28, true);
        const name = new TextDecoder().decode(
          bytes.subarray(offset + 30, offset + 30 + nameLen)
        );
        const dataStart = offset + 30 + nameLen + extraLen;
        if (name === 'word/document.xml' && compressedSize > 0) {
          const payload = bytes.subarray(dataStart, dataStart + compressedSize);
          let xmlText = '';
          if (compression === 0) {
            xmlText = new TextDecoder('utf-8').decode(payload);
          } else if (compression === 8 && typeof DecompressionStream !== 'undefined') {
            const ds = new DecompressionStream('deflate-raw');
            const stream = new Blob([payload]).stream().pipeThrough(ds);
            xmlText = await new Response(stream).text();
          }
          if (xmlText) {
            return xmlText
              .replace(/<\/w:p>/g, '\n')
              .replace(/<[^>]+>/g, ' ')
              .replace(/\s{2,}/g, ' ')
              .trim();
          }
        }
        offset = dataStart + Math.max(1, compressedSize);
      } else {
        offset++;
      }
    }
  } catch {
    // Fallback below
  }
  const raw = new TextDecoder('latin1').decode(buffer);
  return raw.replace(/[^\x20-\x7E\xA0-\xFF\n\r]/g, ' ').replace(/\s{3,}/g, '\n').slice(0, 30000);
}

export async function readFileAsAiAttachment(file: File): Promise<AiAttachment> {
  const lower = file.name.toLowerCase();
  const id = `att_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

  // 1. Native multimodal images (PNG, JPEG, WEBP, GIF) -> sent directly as inlineData
  if (
    file.type.startsWith('image/') ||
    /\.(png|jpe?g|webp|gif)$/i.test(lower)
  ) {
    const mimeType =
      file.type ||
      (lower.endsWith('.png')
        ? 'image/png'
        : lower.endsWith('.webp')
          ? 'image/webp'
          : lower.endsWith('.gif')
            ? 'image/gif'
            : 'image/jpeg');
    const buf = await file.arrayBuffer();
    const base64Data = arrayBufferToBase64(buf);
    return {
      id,
      name: file.name,
      mimeType,
      size: file.size,
      base64Data,
      previewUrl: `data:${mimeType};base64,${base64Data}`,
    };
  }

  // 2. Native PDF -> sent directly as inlineData (application/pdf) so Gemini reads layout, tables & diagrams!
  if (file.type === 'application/pdf' || lower.endsWith('.pdf')) {
    const buf = await file.arrayBuffer();
    const base64Data = arrayBufferToBase64(buf);
    return {
      id,
      name: file.name,
      mimeType: 'application/pdf',
      size: file.size,
      base64Data,
    };
  }

  // 3. Word documents (.docx / .doc)
  if (lower.endsWith('.docx') || lower.endsWith('.doc')) {
    const buf = await file.arrayBuffer();
    const extracted = await extractDocxText(buf);
    return {
      id,
      name: file.name,
      mimeType: file.type || 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      size: file.size,
      textContent: extracted,
    };
  }

  // 4. Plain text / Markdown / Code / PlantUML
  const textContent = await file.text();
  return {
    id,
    name: file.name,
    mimeType: file.type || 'text/plain',
    size: file.size,
    textContent,
  };
}
