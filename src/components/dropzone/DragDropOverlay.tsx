import React, { useEffect, useState } from 'react';
import { UploadCloud } from 'lucide-react';
import { useProjectStore } from '../../store/useProjectStore';

export const DragDropOverlay: React.FC = () => {
  const { importFiles } = useProjectStore();
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    let depth = 0;

    const onDragEnter = (e: DragEvent) => {
      e.preventDefault();
      depth++;
      if (e.dataTransfer?.types.includes('Files')) {
        setDragging(true);
      }
    };

    const onDragOver = (e: DragEvent) => {
      e.preventDefault();
    };

    const onDragLeave = (e: DragEvent) => {
      e.preventDefault();
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };

    const onDrop = async (e: DragEvent) => {
      e.preventDefault();
      depth = 0;
      setDragging(false);

      const fileList = e.dataTransfer?.files;
      if (!fileList || fileList.length === 0) return;

      const loaded: Array<{ name: string; content: string }> = [];
      for (const file of Array.from(fileList)) {
        try {
          loaded.push({ name: file.name, content: await file.text() });
        } catch {
          // ignore unreadable binary files
        }
      }
      if (loaded.length > 0) {
        await importFiles(loaded);
      }
    };

    window.addEventListener('dragenter', onDragEnter);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onDragEnter);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, [importFiles]);

  if (!dragging) return null;

  return (
    <div className="fixed inset-0 z-50 bg-indigo-950/80 backdrop-blur-md border-4 border-dashed border-indigo-400 flex flex-col items-center justify-center gap-3 pointer-events-none">
      <UploadCloud className="w-14 h-14 text-indigo-300 animate-bounce" />
      <div className="text-lg font-bold text-white">
        Déposez vos fichiers pour les modéliser automatiquement
      </div>
      <div className="text-xs text-indigo-200">
        Code source (C++, Java, Python, TypeScript, PHP, Rust, Go) • .puml • .mmd • .xmi • .sql • OpenAPI
      </div>
    </div>
  );
};
