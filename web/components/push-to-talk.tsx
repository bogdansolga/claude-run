import { useEffect, useRef, useState } from "react";
import { MediaRecorderVoiceIo, type VoiceIoState } from "../voice/voice-io";

export function PushToTalk({ agentId }: { agentId: string }) {
  const [state, setState] = useState<VoiceIoState>("idle");
  const [transcript, setTranscript] = useState<string | null>(null);
  const voiceRef = useRef<MediaRecorderVoiceIo | null>(null);

  useEffect(() => () => voiceRef.current?.cancel(), []);

  const createVoice = () => {
    voiceRef.current ??= new MediaRecorderVoiceIo(agentId, {
      onState: setState,
      onTranscript: setTranscript,
    });
    return voiceRef.current;
  };

  return (
    <div className="flex flex-col gap-2 text-xs text-zinc-400">
      <button
        type="button"
        onPointerDown={() => void createVoice().start()}
        onPointerUp={() => void createVoice().stop()}
        onPointerCancel={() => createVoice().cancel()}
        className="rounded bg-indigo-600 px-3 py-2 text-white select-none touch-none"
      >
        {state === "listening" ? "Release to send" : "Hold to speak"}
      </button>
      <span aria-live="polite">{state}</span>
      {transcript && <span className="text-zinc-300">Transcript: {transcript}</span>}
    </div>
  );
}
