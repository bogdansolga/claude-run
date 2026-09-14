export interface BrowserAudioEvent {
  type: "audio";
  clipId: string;
  sequence: number;
  mimeType: string;
  data: string;
}

export interface AudioPlayer {
  onended: (() => void) | null;
  onerror: (() => void) | null;
  play(): Promise<void>;
  pause(): void;
  currentTime: number;
  src: string;
}

export type AudioPlayerFactory = (url: string) => AudioPlayer;

export class BrowserAudioQueue {
  private readonly createPlayer: AudioPlayerFactory;
  private readonly pending: BrowserAudioEvent[] = [];
  private current: AudioPlayer | null = null;
  private last: BrowserAudioEvent | null = null;
  private stopped = false;

  constructor(createPlayer: AudioPlayerFactory = (url) => new Audio(url)) {
    this.createPlayer = createPlayer;
  }

  enqueue(event: BrowserAudioEvent): void {
    if (this.pending.some((item) => item.sequence === event.sequence)) return;
    this.pending.push(event);
    this.pending.sort((a, b) => a.sequence - b.sequence);
    if (!this.stopped) void this.playNext();
  }

  stop(): void {
    this.stopped = true;
    this.pending.length = 0;
    this.current?.pause();
    this.current = null;
  }

  repeat(): void {
    if (!this.last) return;
    this.stopped = false;
    this.current?.pause();
    this.current = null;
    this.pending.unshift(this.last);
    void this.playNext();
  }

  private async playNext(): Promise<void> {
    if (this.current || this.stopped || this.pending.length === 0) return;
    const event = this.pending.shift()!;
    const url = `data:${event.mimeType};base64,${event.data}`;
    const player = this.createPlayer(url);
    this.current = player;
    this.last = event;
    player.onended = () => {
      if (this.current !== player) return;
      this.current = null;
      void this.playNext();
    };
    player.onerror = player.onended;
    try {
      await player.play();
    } catch {
      player.onerror?.();
    }
  }
}
