import { useCallback, useEffect, useRef, useState } from "react";
import { BrowserAudioQueue, type BrowserAudioEvent } from "../voice/audio-queue";

export function VoicePlayback({ events }: { events: BrowserAudioEvent[] }) {
  const queueRef = useRef<BrowserAudioQueue | null>(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    queueRef.current ??= new BrowserAudioQueue();
    for (const event of events) queueRef.current.enqueue(event);
  }, [events]);

  const stop = useCallback(() => {
    queueRef.current?.stop();
    setPlaying(false);
  }, []);

  const repeat = useCallback(() => {
    queueRef.current?.repeat();
    setPlaying(true);
  }, []);

  return (
    <div className="flex items-center gap-2 text-xs text-zinc-400">
      <span>{playing ? "Playing response" : "Audio ready"}</span>
      <button type="button" onClick={stop} className="rounded bg-zinc-800 px-2 py-1 hover:bg-zinc-700">Stop</button>
      <button type="button" onClick={repeat} className="rounded bg-zinc-800 px-2 py-1 hover:bg-zinc-700">Repeat</button>
    </div>
  );
}
