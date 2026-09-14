export interface SttProvider {
  transcribe(audio: { data: Uint8Array; mimeType: string }): Promise<string>;
}

export class FakeSttProvider implements SttProvider {
  private readonly transcript: string;
  private readonly shouldFail: boolean;

  constructor(options: { transcript?: string; fail?: boolean } = {}) {
    this.transcript = options.transcript ?? "status update";
    this.shouldFail = options.fail === true;
  }

  async transcribe(): Promise<string> {
    if (this.shouldFail) throw new Error("fake STT failure");
    return this.transcript;
  }
}
