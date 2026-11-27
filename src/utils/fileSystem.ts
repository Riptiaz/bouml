import { invoke } from '@tauri-apps/api/core';

/**
 * Unified cross-platform Save / Save As utility:
 * 1. Tauri Desktop: opens native OS dialog via @tauri-apps/plugin-dialog, then writes directly via Rust `write_single_file`
 *    (eliminates Tauri v2 plugin-fs scope errors that previously caused a double Save dialog!).
 * 2. Browser: File System Access API (window.showSaveFilePicker) with linked FileSystemFileHandle.
 * 3. Clean browser download fallback.
 */

interface FilePickerAcceptType {
  description?: string;
  accept: Record<string, string[]>;
}

interface SaveFilePickerOptions {
  suggestedName?: string;
  types?: FilePickerAcceptType[];
}

interface WritableStreamLike {
  write: (data: Blob | string | Uint8Array) => Promise<void>;
  close: () => Promise<void>;
}

export interface FileHandleLike {
  name: string;
  createWritable: () => Promise<WritableStreamLike>;
}

declare global {
  interface Window {
    showSaveFilePicker?: (options?: SaveFilePickerOptions) => Promise<FileHandleLike>;
  }
}

function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

let linkedTauriPath: string | null = null;
let linkedFileHandle: FileHandleLike | null = null;

export function clearLinkedProjectFile(): void {
  linkedTauriPath = null;
  linkedFileHandle = null;
}

export function getLinkedProjectFileName(): string | null {
  if (linkedTauriPath) {
    return linkedTauriPath.split(/[\\/]/).pop() ?? linkedTauriPath;
  }
  return linkedFileHandle?.name ?? null;
}

async function contentToByteArray(content: string | Blob): Promise<number[]> {
  if (content instanceof Blob) {
    return Array.from(new Uint8Array(await content.arrayBuffer()));
  }
  return Array.from(new TextEncoder().encode(content));
}

function triggerFallbackDownload(
  suggestedName: string,
  data: string | Blob,
  mime: string
): void {
  const blob = data instanceof Blob ? data : new Blob([data], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = suggestedName;
  a.click();
  URL.revokeObjectURL(url);
}

export interface SaveFileResult {
  saved: boolean;
  cancelled?: boolean;
  filename?: string;
  error?: string;
}

/**
 * Always prompts the user for destination file path & name (Save As / Exports).
 * Guarantees ONLY ONE dialog is ever opened.
 */
export async function saveAsFile(options: {
  suggestedName: string;
  content: string | Blob;
  mimeType: string;
  description: string;
  extensions: string[];
  linkAsProjectFile?: boolean;
}): Promise<SaveFileResult> {
  const { suggestedName, content, mimeType, description, extensions, linkAsProjectFile } = options;

  // 1. Tauri Desktop native Save dialog + Rust direct write (never falls through to a 2nd dialog)
  if (isTauriRuntime()) {
    const { save } = await import('@tauri-apps/plugin-dialog');
    const selectedPath = await save({
      defaultPath: suggestedName,
      filters: [
        {
          name: description,
          extensions: extensions.map((e) => e.replace(/^\./, '')),
        },
      ],
    });
    if (!selectedPath) {
      return { saved: false, cancelled: true };
    }

    const bytes = await contentToByteArray(content);
    await invoke('write_single_file', { path: selectedPath, bytes });

    if (linkAsProjectFile) {
      linkedTauriPath = selectedPath;
      linkedFileHandle = null;
    }
    return {
      saved: true,
      filename: selectedPath.split(/[\\/]/).pop() ?? selectedPath,
    };
  }

  // 2. Browser File System Access API (showSaveFilePicker)
  if (typeof window !== 'undefined' && typeof window.showSaveFilePicker === 'function') {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName,
        types: [
          {
            description,
            accept: {
              [mimeType]: extensions.map((e) => (e.startsWith('.') ? e : `.${e}`)),
            },
          },
        ],
      });
      const writable = await handle.createWritable();
      await writable.write(content);
      await writable.close();

      if (linkAsProjectFile) {
        linkedFileHandle = handle;
        linkedTauriPath = null;
      }
      return { saved: true, filename: handle.name };
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return { saved: false, cancelled: true };
      }
      throw err;
    }
  }

  // 3. Fallback download
  triggerFallbackDownload(suggestedName, content, mimeType);
  return { saved: true, filename: suggestedName };
}

/**
 * Save project (Ctrl+S): overwrites silently if already linked, otherwise prompts once.
 */
export async function saveProjectFile(
  suggestedName: string,
  jsonContent: string
): Promise<SaveFileResult> {
  if (isTauriRuntime() && linkedTauriPath) {
    try {
      const bytes = await contentToByteArray(jsonContent);
      await invoke('write_single_file', { path: linkedTauriPath, bytes });
      return {
        saved: true,
        filename: linkedTauriPath.split(/[\\/]/).pop() ?? linkedTauriPath,
      };
    } catch {
      linkedTauriPath = null;
    }
  }

  if (linkedFileHandle) {
    try {
      const writable = await linkedFileHandle.createWritable();
      await writable.write(jsonContent);
      await writable.close();
      return { saved: true, filename: linkedFileHandle.name };
    } catch {
      linkedFileHandle = null;
    }
  }

  return saveAsFile({
    suggestedName,
    content: jsonContent,
    mimeType: 'application/json',
    description: 'Projet BouML v2 (.bouml.json)',
    extensions: ['.json'],
    linkAsProjectFile: true,
  });
}
