/**
 * Unified cross-platform Save / Save As utility:
 * 1. Tauri Desktop native dialog (Windows, macOS, Linux) via @tauri-apps/plugin-dialog + plugin-fs
 * 2. Browser File System Access API (window.showSaveFilePicker) with linked FileSystemFileHandle
 * 3. Clean browser download fallback
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

// Active linked project file target for silent Ctrl+S overwrites
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
}

/**
 * Always prompts the user for destination file path & name (Save As / Exports).
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

  // 1. Tauri Desktop native Save dialog
  if (isTauriRuntime()) {
    try {
      const { save } = await import('@tauri-apps/plugin-dialog');
      const { writeTextFile, writeFile } = await import('@tauri-apps/plugin-fs');
      const selectedPath = await save({
        defaultPath: suggestedName,
        filters: [
          {
            name: description,
            extensions: extensions.map((e) => e.replace(/^\./, '')),
          },
        ],
      });
      if (!selectedPath) return { saved: false, cancelled: true };

      if (content instanceof Blob) {
        const bytes = new Uint8Array(await content.arrayBuffer());
        await writeFile(selectedPath, bytes);
      } else {
        await writeTextFile(selectedPath, content);
      }

      if (linkAsProjectFile) {
        linkedTauriPath = selectedPath;
        linkedFileHandle = null;
      }
      return {
        saved: true,
        filename: selectedPath.split(/[\\/]/).pop() ?? selectedPath,
      };
    } catch {
      // Fall through to File System Access API or browser download
    }
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
    }
  }

  // 3. Fallback download
  triggerFallbackDownload(suggestedName, content, mimeType);
  return { saved: true, filename: suggestedName };
}

/**
 * Save project (Ctrl+S): overwrites silently if already linked, otherwise prompts with Save As dialog.
 */
export async function saveProjectFile(
  suggestedName: string,
  jsonContent: string
): Promise<SaveFileResult> {
  if (isTauriRuntime() && linkedTauriPath) {
    try {
      const { writeTextFile } = await import('@tauri-apps/plugin-fs');
      await writeTextFile(linkedTauriPath, jsonContent);
      return {
        saved: true,
        filename: linkedTauriPath.split(/[\\/]/).pop() ?? linkedTauriPath,
      };
    } catch {
      // Re-prompt on error
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
