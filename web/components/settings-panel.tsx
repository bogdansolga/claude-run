import { Settings, Minus, Plus } from "lucide-react";
import { useState } from "react";

interface SettingsPanelProps {
  navbarFontSize: number;
  terminalFontSize: number;
  onNavbarFontSizeChange: (size: number) => void;
  onTerminalFontSizeChange: (size: number) => void;
}

export function SettingsPanel({
  navbarFontSize,
  terminalFontSize,
  onNavbarFontSizeChange,
  onTerminalFontSizeChange,
}: SettingsPanelProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="p-2 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 rounded-lg transition-colors"
        title="Settings"
      >
        <Settings className="w-4 h-4" />
      </button>

      {isOpen && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-40"
            onClick={() => setIsOpen(false)}
          />

          {/* Panel */}
          <div className="absolute right-0 top-full mt-2 w-64 bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl z-50 p-4">
            <h3 className="text-sm font-medium text-zinc-200 mb-4">Display Settings</h3>

            {/* Navbar Font Size */}
            <div className="mb-4">
              <label className="text-xs text-zinc-400 block mb-2">
                Sidebar Font Size ({navbarFontSize}px)
              </label>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => onNavbarFontSizeChange(navbarFontSize - 1)}
                  disabled={navbarFontSize <= 12}
                  className="p-1.5 bg-zinc-800 hover:bg-zinc-700 rounded disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Minus className="w-3 h-3" />
                </button>
                <div className="flex-1 h-1.5 bg-zinc-800 rounded-full relative">
                  <div
                    className="absolute h-full bg-cyan-600 rounded-full"
                    style={{ width: `${((navbarFontSize - 12) / 6) * 100}%` }}
                  />
                </div>
                <button
                  onClick={() => onNavbarFontSizeChange(navbarFontSize + 1)}
                  disabled={navbarFontSize >= 18}
                  className="p-1.5 bg-zinc-800 hover:bg-zinc-700 rounded disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Plus className="w-3 h-3" />
                </button>
              </div>
            </div>

            {/* Terminal Font Size */}
            <div>
              <label className="text-xs text-zinc-400 block mb-2">
                Terminal Font Size ({terminalFontSize}px)
              </label>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => onTerminalFontSizeChange(terminalFontSize - 1)}
                  disabled={terminalFontSize <= 10}
                  className="p-1.5 bg-zinc-800 hover:bg-zinc-700 rounded disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Minus className="w-3 h-3" />
                </button>
                <div className="flex-1 h-1.5 bg-zinc-800 rounded-full relative">
                  <div
                    className="absolute h-full bg-cyan-600 rounded-full"
                    style={{ width: `${((terminalFontSize - 10) / 10) * 100}%` }}
                  />
                </div>
                <button
                  onClick={() => onTerminalFontSizeChange(terminalFontSize + 1)}
                  disabled={terminalFontSize >= 20}
                  className="p-1.5 bg-zinc-800 hover:bg-zinc-700 rounded disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Plus className="w-3 h-3" />
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
