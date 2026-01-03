import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import type { Session } from "@claude-run/api";
import { Toaster, toast } from "sonner";
import { PanelLeft, Copy, Check, ChevronUp, ChevronDown, X, Maximize2, Minimize2 } from "lucide-react";
import { formatTime } from "./utils";
import SessionList from "./components/session-list";
import SessionView from "./components/session-view";
import { useEventSource } from "./hooks/use-event-source";
import { TerminalPanel } from "./components/terminal-panel";
import { NewSessionModal } from "./components/new-session-modal";
import {
  ActiveSessionsList,
  type TerminalSessionInfo,
} from "./components/active-sessions-list";
import { SettingsPanel } from "./components/settings-panel";
import { useSettings } from "./hooks/use-settings";

interface SessionHeaderProps {
  session: Session;
  copied: boolean;
  onCopyResumeCommand: (sessionId: string, projectPath: string) => void;
}

function SessionHeader(props: SessionHeaderProps) {
  const { session, copied, onCopyResumeCommand } = props;

  return (
    <>
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <span className="text-sm text-zinc-300 truncate max-w-xs">
          {session.display}
        </span>
        <span className="text-xs text-zinc-600 shrink-0">
          {session.projectName}
        </span>
        <span className="text-xs text-zinc-600 shrink-0">
          {formatTime(session.timestamp)}
        </span>
      </div>
      <button
        onClick={() => onCopyResumeCommand(session.id, session.project)}
        className="flex items-center gap-2 px-2.5 py-1.5 text-xs text-zinc-300 bg-zinc-800 hover:bg-zinc-700 rounded transition-colors cursor-pointer shrink-0"
        title="Copy resume command to clipboard"
      >
        {copied ? (
          <>
            <Check className="w-3.5 h-3.5 text-green-500" />
            <span className="text-green-500">Copied!</span>
          </>
        ) : (
          <>
            <Copy className="w-3.5 h-3.5" />
            <span>Copy Resume Command</span>
          </>
        )}
      </button>
    </>
  );
}

const MIN_TERMINAL_HEIGHT = 150;
const MAX_TERMINAL_HEIGHT = 600;
const DEFAULT_TERMINAL_HEIGHT = 300;

function App() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [projects, setProjects] = useState<string[]>([]);
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [selectedSession, setSelectedSession] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [copied, setCopied] = useState(false);

  // Terminal state
  const [activeTerminal, setActiveTerminal] = useState<string | null>(null);
  const [terminalRepo, setTerminalRepo] = useState<string | null>(null);
  const [terminalHeight, setTerminalHeight] = useState(DEFAULT_TERMINAL_HEIGHT);
  const [terminalCollapsed, setTerminalCollapsed] = useState(false);
  const [terminalMaximized, setTerminalMaximized] = useState(false);
  const [terminalSessions, setTerminalSessions] = useState<TerminalSessionInfo[]>([]);
  const [terminalSessionsLoading, setTerminalSessionsLoading] = useState(true);
  const [showNewSessionModal, setShowNewSessionModal] = useState(false);
  const [showCloseConfirmation, setShowCloseConfirmation] = useState(false);

  // Settings
  const { settings, setNavbarFontSize, setTerminalFontSize } = useSettings();

  // Drag state for resizable divider
  const isDraggingRef = useRef(false);
  const dragStartYRef = useRef(0);
  const dragStartHeightRef = useRef(0);

  const handleCopyResumeCommand = useCallback(
    (sessionId: string, projectPath: string) => {
      const command = `cd ${projectPath} && claude --resume ${sessionId}`;
      navigator.clipboard.writeText(command).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      });
    },
    [],
  );

  const selectedSessionData = useMemo(() => {
    if (!selectedSession) {
      return null;
    }

    return sessions.find((s) => s.id === selectedSession) || null;
  }, [sessions, selectedSession]);

  // Fetch projects
  useEffect(() => {
    fetch("/api/projects")
      .then((res) => res.json())
      .then(setProjects)
      .catch(console.error);
  }, []);

  // Fetch terminal sessions
  const fetchTerminalSessions = useCallback(async () => {
    try {
      const res = await fetch("/api/terminals");
      const data = await res.json();
      setTerminalSessions(data);
    } catch (err) {
      console.error("Failed to fetch terminal sessions:", err);
    } finally {
      setTerminalSessionsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTerminalSessions();
    // Poll for terminal sessions every 5 seconds
    const interval = setInterval(fetchTerminalSessions, 5000);
    return () => clearInterval(interval);
  }, [fetchTerminalSessions]);

  const handleSessionsFull = useCallback((event: MessageEvent) => {
    const data: Session[] = JSON.parse(event.data);
    setSessions(data);
    setLoading(false);
  }, []);

  const handleSessionsUpdate = useCallback((event: MessageEvent) => {
    const updates: Session[] = JSON.parse(event.data);
    setSessions((prev) => {
      const sessionMap = new Map(prev.map((s) => [s.id, s]));
      for (const update of updates) {
        sessionMap.set(update.id, update);
      }
      return Array.from(sessionMap.values()).sort(
        (a, b) => b.timestamp - a.timestamp,
      );
    });
  }, []);

  const handleSessionsError = useCallback(() => {
    setLoading(false);
  }, []);

  useEventSource("/api/sessions/stream", {
    events: [
      { eventName: "sessions", onMessage: handleSessionsFull },
      { eventName: "sessionsUpdate", onMessage: handleSessionsUpdate },
    ],
    onError: handleSessionsError,
  });

  const filteredSessions = useMemo(() => {
    if (!selectedProject) {
      return sessions;
    }
    return sessions.filter((s) => s.project === selectedProject);
  }, [sessions, selectedProject]);

  const handleSelectSession = useCallback((sessionId: string) => {
    setSelectedSession(sessionId);
  }, []);

  // Terminal session handlers
  const handleNewSession = useCallback(() => {
    setShowNewSessionModal(true);
  }, []);

  // Track selected host for new session
  const [terminalHost, setTerminalHost] = useState<string | null>(null);

  const handleSessionCreated = useCallback((_sessionId: string, repo: string, hostId: string) => {
    // Close modal and set up for new session creation via WebSocket
    setShowNewSessionModal(false);
    setTerminalRepo(repo);
    setTerminalHost(hostId);
    setActiveTerminal(null); // Will connect via repo
    setTerminalCollapsed(false);
    toast.info("Connecting to new terminal session...");
  }, []);

  const handleSelectTerminalSession = useCallback((sessionId: string) => {
    setActiveTerminal(sessionId);
    setTerminalRepo(null);
    setTerminalCollapsed(false);
    toast.info("Reconnecting to terminal session...");
  }, []);

  const handleTerminalSessionInfo = useCallback(
    (info: { id: string; repo: string; host: string; hostLabel?: string }) => {
      setActiveTerminal(info.id);
      setTerminalRepo(null);
      setTerminalHost(null);
      toast.success(`Terminal connected to ${info.hostLabel || info.host}`);
      // Refresh terminal sessions list
      fetchTerminalSessions();
    },
    [fetchTerminalSessions],
  );

  const handleTerminalError = useCallback((message: string) => {
    // Silently close terminal panel for "session not found" - not a real error
    if (message.includes("not found")) {
      setActiveTerminal(null);
      setTerminalRepo(null);
      setTerminalHost(null);
      return; // Don't show toast
    }
    toast.error(`Terminal error: ${message}`);
  }, []);

  const handleTerminalExit = useCallback(
    (exitCode: number, signal?: number) => {
      if (signal) {
        toast.info(`Terminal exited with signal ${signal}`);
      } else if (exitCode !== 0) {
        toast.info(`Terminal exited with code ${exitCode}`);
      }
      // Close terminal panel and reset state
      setActiveTerminal(null);
      setTerminalRepo(null);
      setTerminalHost(null);
      setTerminalMaximized(false);
      // Refresh terminal sessions list
      fetchTerminalSessions();
    },
    [fetchTerminalSessions],
  );

  const handleCloseTerminal = useCallback(() => {
    // If there's an active session, show confirmation
    if (activeTerminal) {
      setShowCloseConfirmation(true);
      return;
    }
    setActiveTerminal(null);
    setTerminalRepo(null);
    setTerminalHost(null);
    setTerminalMaximized(false);
  }, [activeTerminal]);

  const handleConfirmClose = useCallback(() => {
    setActiveTerminal(null);
    setTerminalRepo(null);
    setTerminalHost(null);
    setTerminalMaximized(false);
    setShowCloseConfirmation(false);
  }, []);

  const handleCancelClose = useCallback(() => {
    setShowCloseConfirmation(false);
  }, []);

  const handleToggleMaximize = useCallback(() => {
    setTerminalMaximized((prev) => !prev);
    if (terminalCollapsed) {
      setTerminalCollapsed(false);
    }
  }, [terminalCollapsed]);

  // Drag handlers for resizable terminal panel
  const handleDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingRef.current = true;
    dragStartYRef.current = e.clientY;
    dragStartHeightRef.current = terminalHeight;
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";
  }, [terminalHeight]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDraggingRef.current) return;

      const delta = dragStartYRef.current - e.clientY;
      const newHeight = Math.min(
        MAX_TERMINAL_HEIGHT,
        Math.max(MIN_TERMINAL_HEIGHT, dragStartHeightRef.current + delta)
      );
      setTerminalHeight(newHeight);
    };

    const handleMouseUp = () => {
      if (isDraggingRef.current) {
        isDraggingRef.current = false;
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      }
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, []);

  const showTerminalPanel = activeTerminal !== null || terminalRepo !== null;

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Check for Cmd (Mac) or Ctrl (Windows/Linux)
      const isMod = e.metaKey || e.ctrlKey;

      // Cmd/Ctrl + T - Open new session modal
      if (isMod && e.key === "t") {
        e.preventDefault();
        setShowNewSessionModal(true);
        return;
      }

      // Cmd/Ctrl + ` (backtick) - Toggle terminal panel visibility
      if (isMod && e.key === "`") {
        e.preventDefault();
        if (showTerminalPanel) {
          setTerminalCollapsed((prev) => !prev);
        }
        return;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [showTerminalPanel]);

  return (
    <div className="flex h-screen bg-zinc-950 text-zinc-100">
      <Toaster
        position="top-right"
        theme="dark"
        toastOptions={{
          style: {
            background: "#18181b",
            border: "1px solid #27272a",
            color: "#fafafa",
          },
        }}
      />

      {/* New Session Modal */}
      <NewSessionModal
        open={showNewSessionModal}
        onClose={() => setShowNewSessionModal(false)}
        onSessionCreated={handleSessionCreated}
        projects={projects}
      />

      {!sidebarCollapsed && (
        <aside
          className="w-80 border-r border-zinc-800/60 flex flex-col bg-zinc-950"
          style={{ fontSize: `${settings.navbarFontSize}px` }}
        >
          <div className="border-b border-zinc-800/60">
            <label htmlFor={"select-project"} className="block w-full px-1">
              <select
                id={"select-project"}
                value={selectedProject || ""}
                onChange={(e) => setSelectedProject(e.target.value || null)}
                className="w-full h-12.5 bg-transparent text-zinc-300 text-sm focus:outline-none cursor-pointer px-5 py-4"
              >
                <option value="">All Projects</option>
                {projects.map((project) => {
                  const name = project.split("/").pop() || project;
                  return (
                    <option key={project} value={project}>
                      {name}
                    </option>
                  );
                })}
              </select>
            </label>
          </div>

          {/* Active Terminal Sessions */}
          <ActiveSessionsList
            sessions={terminalSessions}
            activeSession={activeTerminal}
            onSelectSession={handleSelectTerminalSession}
            onNewSession={handleNewSession}
            loading={terminalSessionsLoading}
          />

          <SessionList
            sessions={filteredSessions}
            selectedSession={selectedSession}
            onSelectSession={handleSelectSession}
            loading={loading}
          />
        </aside>
      )}

      <main className="flex-1 overflow-hidden bg-zinc-950 flex flex-col">
        <div className="h-12.5 border-b border-zinc-800/60 flex items-center px-4 gap-4">
          <button
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            className="p-1.5 hover:bg-zinc-800 rounded transition-colors cursor-pointer"
            aria-label={
              sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"
            }
          >
            <PanelLeft className="w-4 h-4 text-zinc-400" />
          </button>
          {selectedSessionData && (
            <SessionHeader
              session={selectedSessionData}
              copied={copied}
              onCopyResumeCommand={handleCopyResumeCommand}
            />
          )}
          <div className="flex-1" />
          <SettingsPanel
            navbarFontSize={settings.navbarFontSize}
            terminalFontSize={settings.terminalFontSize}
            onNavbarFontSizeChange={setNavbarFontSize}
            onTerminalFontSizeChange={setTerminalFontSize}
          />
        </div>

        {/* Content area with split view */}
        <div className="flex-1 overflow-hidden flex flex-col">
          {/* Session view (takes remaining space, hidden when terminal maximized on mobile) */}
          {!terminalMaximized && (
            <div
              className="flex-1 overflow-hidden"
              style={{
                minHeight: showTerminalPanel && !terminalCollapsed ? "200px" : undefined,
              }}
            >
              {selectedSession ? (
                <SessionView sessionId={selectedSession} />
              ) : (
                <div className="flex h-full items-center justify-center text-zinc-600">
                  <div className="text-center">
                    <div className="text-base mb-2 text-zinc-500">
                      Select a session
                    </div>
                    <div className="text-sm text-zinc-600">
                      Choose a session from the list to view the conversation
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Terminal Panel */}
          {showTerminalPanel && (
            <div className={terminalMaximized ? "flex-1 flex flex-col" : ""}>
              {/* Resize handle and header */}
              <div className="border-t border-zinc-800/60 bg-zinc-900">
                {/* Draggable divider (hidden when maximized) */}
                {!terminalCollapsed && !terminalMaximized && (
                  <div
                    onMouseDown={handleDragStart}
                    className="h-1 bg-zinc-800 hover:bg-cyan-600 cursor-row-resize transition-colors"
                  />
                )}

                {/* Terminal header */}
                <div className="flex items-center justify-between px-3 py-1.5">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-zinc-400">
                      Terminal
                    </span>
                    {activeTerminal && (
                      <span className="text-[10px] text-zinc-600 font-mono">
                        {activeTerminal.slice(0, 8)}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    {/* Maximize/Minimize button */}
                    <button
                      onClick={handleToggleMaximize}
                      className="p-1 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 rounded transition-colors"
                      title={terminalMaximized ? "Exit full screen" : "Full screen"}
                    >
                      {terminalMaximized ? (
                        <Minimize2 className="w-4 h-4" />
                      ) : (
                        <Maximize2 className="w-4 h-4" />
                      )}
                    </button>
                    {/* Collapse button (hidden when maximized) */}
                    {!terminalMaximized && (
                      <button
                        onClick={() => setTerminalCollapsed(!terminalCollapsed)}
                        className="p-1 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 rounded transition-colors"
                        title={terminalCollapsed ? "Expand terminal" : "Collapse terminal"}
                      >
                        {terminalCollapsed ? (
                          <ChevronUp className="w-4 h-4" />
                        ) : (
                          <ChevronDown className="w-4 h-4" />
                        )}
                      </button>
                    )}
                    <button
                      onClick={handleCloseTerminal}
                      className="p-1 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 rounded transition-colors"
                      title="Close terminal"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>

              {/* Terminal content */}
              {!terminalCollapsed && (
                <div
                  style={terminalMaximized ? { flex: 1 } : { height: `${terminalHeight}px` }}
                  className="bg-zinc-950 overflow-hidden"
                >
                  <TerminalPanel
                    sessionId={activeTerminal || undefined}
                    repo={terminalRepo || undefined}
                    host={terminalHost || undefined}
                    fontSize={settings.terminalFontSize}
                    onSessionInfo={handleTerminalSessionInfo}
                    onError={handleTerminalError}
                    onExit={handleTerminalExit}
                  />
                </div>
              )}
            </div>
          )}
        </div>
      </main>

      {/* Close Confirmation Modal */}
      {showCloseConfirmation && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={handleCancelClose}
          />
          <div className="relative w-full max-w-sm mx-4 bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl p-5">
            <h3 className="text-lg font-medium text-zinc-100 mb-2">
              Close Terminal?
            </h3>
            <p className="text-sm text-zinc-400 mb-5">
              The terminal session will continue running in the background. You can reconnect from the Active Terminals list.
            </p>
            <div className="flex items-center justify-end gap-3">
              <button
                onClick={handleCancelClose}
                className="px-4 py-2 text-sm font-medium text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmClose}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-500 rounded-lg transition-colors"
              >
                Close Terminal
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
