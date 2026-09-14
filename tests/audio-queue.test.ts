import assert from "node:assert/strict";
import test from "node:test";

import { BrowserAudioQueue, type AudioPlayer } from "../web/voice/audio-queue.js";

class FakePlayer implements AudioPlayer {
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  currentTime = 0;
  played = false;
  paused = false;
  constructor(readonly src: string) {}
  async play(): Promise<void> { this.played = true; }
  pause(): void { this.paused = true; }
}

test("queues ordered audio, ignores duplicate events, and supports stop/repeat", () => {
  const players: FakePlayer[] = [];
  const queue = new BrowserAudioQueue((url) => {
    const player = new FakePlayer(url);
    players.push(player);
    return player;
  });
  queue.enqueue({ type: "audio", clipId: "one", sequence: 1, mimeType: "audio/wav", data: "MQ==" });
  queue.enqueue({ type: "audio", clipId: "two", sequence: 2, mimeType: "audio/wav", data: "Mg==" });
  queue.enqueue({ type: "audio", clipId: "two", sequence: 2, mimeType: "audio/wav", data: "Mg==" });

  assert.equal(players.length, 1);
  assert.match(players[0]!.src, /MQ==/);
  players[0]!.onended?.();
  assert.equal(players.length, 2);
  assert.match(players[1]!.src, /Mg==/);

  queue.stop();
  assert.equal(players[1]!.paused, true);
  queue.repeat();
  assert.equal(players.length, 3);
  assert.match(players[2]!.src, /Mg==/);
});
