import React, { useEffect, useState } from "react";
import { Search } from "lucide-react";

export interface PaletteAction {
  id: string;
  label: string;
  category: string;
  shortcut?: string;
  run: () => void;
}

interface Props {
  open: boolean;
  onClose: () => void;
  actions: PaletteAction[];
}

export const CommandPalette: React.FC<Props> = ({ open, onClose, actions }) => {
  const [query, setQuery] = useState("");
  const [selectedIdx, setSelectedIdx] = useState(0);

  const filtered = actions.filter((a) =>
    `${a.category} ${a.label}`.toLowerCase().includes(query.toLowerCase())
  );

  useEffect(() => {
    setSelectedIdx(0);
  }, [query, open]);

  if (!open) return null;

  return (
    <div className="palette-backdrop" onClick={onClose}>
      <div className="palette-modal" onClick={(e) => e.stopPropagation()}>
        <div className="palette-input-row">
          <Search size={16} />
          <input
            autoFocus
            value={query}
            placeholder="Type a command (e.g. Add Class, Auto-Layout, Rust, Theme)..."
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") onClose();
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setSelectedIdx((i) => Math.min(i + 1, Math.max(filtered.length - 1, 0)));
              }
              if (e.key === "ArrowUp") {
                e.preventDefault();
                setSelectedIdx((i) => Math.max(i - 1, 0));
              }
              if (e.key === "Enter" && filtered[selectedIdx]) {
                filtered[selectedIdx].run();
                setQuery("");
                onClose();
              }
            }}
          />
        </div>

        <div className="palette-list">
          {filtered.length === 0 ? (
            <div className="palette-empty">No matching commands</div>
          ) : (
            filtered.map((action, idx) => (
              <button
                key={action.id}
                className={`palette-item ${idx === selectedIdx ? "active" : ""}`}
                onMouseEnter={() => setSelectedIdx(idx)}
                onClick={() => {
                  action.run();
                  setQuery("");
                  onClose();
                }}
              >
                <span className="palette-cat">{action.category}</span>
                <span className="palette-label">{action.label}</span>
                {action.shortcut && <kbd className="palette-kbd">{action.shortcut}</kbd>}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
