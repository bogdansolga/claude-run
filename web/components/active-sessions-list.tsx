import { memo } from "react";
import { Terminal, Plus, Circle } from "lucide-react";

export interface TerminalSessionInfo {
  id: string;
  repo: string;
  host: string;
  createdAt: number;
  clientCount: number;
}

export interface ActiveSessionsListProps {
  sessions: TerminalSessionInfo[];
  activeSession: string | null;
  onSelectSession: (sessionId: string) => void;
  onNewSession: () => void;
  loading?: boolean;
}

function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;

  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
}

export const ActiveSessionsList = memo(function ActiveSessionsList({
  sessions,
  activeSession,
  onSelectSession,
  onNewSession,
  loading = false,
}: ActiveSessionsListProps) {
  return (
    <div className="border-b border-zinc-800/60">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2">
        <div className="flex items-center gap-2">
          <Terminal className="w-4 h-4 text-zinc-500" />
          <span className="text-xs font-medium text-zinc-500 uppercase tracking-wide">
            Active Terminals
          </span>
          {sessions.length > 0 && (
            <span className="px-1.5 py-0.5 text-[10px] font-medium bg-cyan-600/20 text-cyan-400 rounded">
              {sessions.length}
            </span>
          )}
        </div>
        <button
          onClick={onNewSession}
          className="p-1 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 rounded transition-colors"
          title="New terminal session"
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>

      {/* Sessions list */}
      <div className="px-2 pb-2">
        {loading ? (
          <div className="flex items-center justify-center py-3">
            <svg
              className="w-4 h-4 text-zinc-600 animate-spin"
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
          </div>
        ) : sessions.length === 0 ? (
          <button
            onClick={onNewSession}
            className="w-full px-3 py-3 text-left rounded-lg border border-dashed border-zinc-800 hover:border-zinc-700 hover:bg-zinc-900/50 transition-colors group"
          >
            <div className="flex items-center gap-2 text-zinc-500 group-hover:text-zinc-400">
              <Plus className="w-4 h-4" />
              <span className="text-xs">Start a new session</span>
            </div>
          </button>
        ) : (
          <div className="space-y-1">
            {sessions.map((session) => {
              const repoName = session.repo.split("/").pop() || session.repo;
              const isActive = activeSession === session.id;

              return (
                <button
                  key={session.id}
                  onClick={() => onSelectSession(session.id)}
                  className={`w-full px-3 py-2 text-left rounded-lg transition-colors ${
                    isActive
                      ? "bg-cyan-700/30 border border-cyan-700/50"
                      : "hover:bg-zinc-900/60 border border-transparent"
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2 min-w-0">
                      <Circle
                        className={`w-2 h-2 flex-shrink-0 ${
                          isActive ? "text-cyan-400 fill-cyan-400" : "text-green-500 fill-green-500"
                        }`}
                      />
                      <span className="text-xs font-medium text-zinc-300 truncate">
                        {repoName}
                      </span>
                    </div>
                    <span className="text-[10px] text-zinc-600 flex-shrink-0">
                      {formatRelativeTime(session.createdAt)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 ml-4">
                    <span className="text-[10px] text-zinc-600 truncate">
                      {session.host}
                    </span>
                    {session.clientCount > 1 && (
                      <span className="text-[10px] text-zinc-600">
                        ({session.clientCount} clients)
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
});

export default ActiveSessionsList;
