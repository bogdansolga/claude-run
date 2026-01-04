import { memo } from "react";
import { ChevronDown, Server, Monitor } from "lucide-react";

export interface HostInfo {
  id: string;
  label: string;
  type: "local" | "ssh";
  host?: string;
  user?: string;
  default?: boolean;
  status: "online" | "offline" | "unknown";
}

export interface HostSelectorProps {
  hosts: HostInfo[];
  selectedHost: string;
  onSelectHost: (hostId: string) => void;
  disabled?: boolean;
  defaultHostId?: string;
}

function StatusDot({ status }: { status: "online" | "offline" | "unknown" }) {
  const colorClass =
    status === "online"
      ? "bg-green-500"
      : status === "offline"
        ? "bg-red-500"
        : "bg-yellow-500";

  return (
    <span
      className={`inline-block w-2 h-2 rounded-full ${colorClass}`}
      title={status}
    />
  );
}

export const HostSelector = memo(function HostSelector({
  hosts,
  selectedHost,
  onSelectHost,
  disabled = false,
  defaultHostId,
}: HostSelectorProps) {
  const selectedHostData = hosts.find((h) => h.id === selectedHost);

  return (
    <div className="relative">
      <select
        value={selectedHost}
        onChange={(e) => onSelectHost(e.target.value)}
        disabled={disabled}
        className="w-full h-11 px-4 pr-10 bg-zinc-800 border border-zinc-700 text-zinc-200 rounded-lg text-sm focus:outline-none focus:border-cyan-600 focus:ring-1 focus:ring-cyan-600 cursor-pointer appearance-none disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {hosts.length === 0 ? (
          <option value="">No hosts available</option>
        ) : (
          hosts.map((host) => (
            <option key={host.id} value={host.id}>
              {host.label}
              {host.id === defaultHostId ? " (default)" : ""}
              {host.status === "offline" ? " - offline" : ""}
            </option>
          ))
        )}
      </select>
      <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500 pointer-events-none" />

      {/* Host info display */}
      {selectedHostData && (
        <div className="mt-2 flex items-center gap-2 text-xs text-zinc-500">
          <StatusDot status={selectedHostData.status} />
          <span className="flex items-center gap-1">
            {selectedHostData.type === "local" ? (
              <Monitor className="w-3 h-3" />
            ) : (
              <Server className="w-3 h-3" />
            )}
            {selectedHostData.type === "ssh" && selectedHostData.host
              ? `${selectedHostData.user}@${selectedHostData.host}`
              : "Local machine"}
          </span>
        </div>
      )}
    </div>
  );
});

export default HostSelector;
