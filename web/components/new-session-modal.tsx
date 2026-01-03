import { useState, useEffect, useCallback } from "react";
import { X, Terminal, ChevronDown } from "lucide-react";

export interface NewSessionModalProps {
  open: boolean;
  onClose: () => void;
  onSessionCreated: (sessionId: string, repo: string) => void;
  projects: string[];
}

export function NewSessionModal({
  open,
  onClose,
  onSessionCreated,
  projects,
}: NewSessionModalProps) {
  const [selectedRepo, setSelectedRepo] = useState<string>("");
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset state when modal opens
  useEffect(() => {
    if (open) {
      setSelectedRepo(projects[0] || "");
      setIsConnecting(false);
      setError(null);
    }
  }, [open, projects]);

  // Handle escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape" && open && !isConnecting) {
        onClose();
      }
    };

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [open, isConnecting, onClose]);

  const handleStartSession = useCallback(() => {
    if (!selectedRepo || isConnecting) return;

    setIsConnecting(true);
    setError(null);

    // The actual connection will be handled by the parent component
    // We just pass the selected repo back
    onSessionCreated("", selectedRepo);
  }, [selectedRepo, isConnecting, onSessionCreated]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={() => !isConnecting && onClose()}
      />

      {/* Modal */}
      <div className="relative w-full max-w-md mx-4 bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800">
          <div className="flex items-center gap-3">
            <Terminal className="w-5 h-5 text-cyan-500" />
            <h2 className="text-lg font-medium text-zinc-100">
              New Terminal Session
            </h2>
          </div>
          <button
            onClick={onClose}
            disabled={isConnecting}
            className="p-1.5 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="px-5 py-5">
          <label className="block">
            <span className="text-sm font-medium text-zinc-400 mb-2 block">
              Select Repository
            </span>
            <div className="relative">
              <select
                value={selectedRepo}
                onChange={(e) => setSelectedRepo(e.target.value)}
                disabled={isConnecting}
                className="w-full h-11 px-4 pr-10 bg-zinc-800 border border-zinc-700 text-zinc-200 rounded-lg text-sm focus:outline-none focus:border-cyan-600 focus:ring-1 focus:ring-cyan-600 cursor-pointer appearance-none disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {projects.length === 0 ? (
                  <option value="">No projects available</option>
                ) : (
                  projects.map((project) => {
                    const name = project.split("/").pop() || project;
                    return (
                      <option key={project} value={project}>
                        {name}
                      </option>
                    );
                  })
                )}
              </select>
              <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500 pointer-events-none" />
            </div>
            {selectedRepo && (
              <p className="mt-2 text-xs text-zinc-500 truncate">
                {selectedRepo}
              </p>
            )}
          </label>

          {error && (
            <div className="mt-4 p-3 bg-red-950/50 border border-red-900/50 rounded-lg">
              <p className="text-sm text-red-400">{error}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-zinc-800">
          <button
            onClick={onClose}
            disabled={isConnecting}
            className="px-4 py-2 text-sm font-medium text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Cancel
          </button>
          <button
            onClick={handleStartSession}
            disabled={!selectedRepo || isConnecting}
            className="px-4 py-2 text-sm font-medium text-white bg-cyan-600 hover:bg-cyan-500 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {isConnecting ? (
              <>
                <svg
                  className="w-4 h-4 animate-spin"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  />
                </svg>
                Connecting...
              </>
            ) : (
              <>
                <Terminal className="w-4 h-4" />
                Start Session
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

export default NewSessionModal;
