import type { AgentEventRecord } from "./agent-manager.js";

export type SpeechMode = "verbatim" | "summary" | "questions_only";
export type SpeechChunkKind = "assistant" | "summary" | "question" | "permission" | "tool";

export interface SpeechChunk {
  id: string;
  sequence: number;
  kind: SpeechChunkKind;
  text: string;
}

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=\.)\s+|(?<=!)\s+|(?<=\?)\s+|(?<=\])\s*|\n+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function describeCodeBlocks(text: string): string {
  return text.replace(/```(?:[\w+-]+)?\n([\s\S]*?)```/g, (_match, code: string) => {
    const lines = code.trim().split(/\r?\n/).filter(Boolean).length;
    return `[${lines} line${lines === 1 ? "" : "s"} of code in a code block]`;
  });
}

function assistantText(payload: Record<string, unknown>): string {
  return typeof payload.delta === "string" ? payload.delta : typeof payload.text === "string" ? payload.text : "";
}

export class SpeechPolicy {
  private readonly mode: SpeechMode;
  private readonly pending: string[] = [];
  private nextSequence = 1;

  constructor(mode: SpeechMode) {
    this.mode = mode;
  }

  consume(event: Pick<AgentEventRecord, "type" | "payload">): SpeechChunk[] {
    if (event.type === "assistant_text") {
      const text = assistantText(event.payload);
      if (!text) return [];
      if (this.mode === "questions_only" || this.mode === "summary") {
        this.pending.push(text);
        return [];
      }
      return this.makeChunks("assistant", splitSentences(describeCodeBlocks(text)));
    }

    if (event.type === "turn_complete" && this.mode === "summary") {
      const text = this.pending.join(" ").trim();
      this.pending.length = 0;
      const firstSentence = splitSentences(text)[0];
      return firstSentence ? this.makeChunks("summary", [firstSentence]) : [];
    }

    if (event.type === "question") {
      const question = typeof event.payload.question === "string" ? event.payload.question : "Claude asked a question.";
      return this.makeChunks("question", [question]);
    }

    if (event.type === "permission_request") {
      const tool = typeof event.payload.tool === "string" ? event.payload.tool : "a tool";
      return this.makeChunks("permission", [`Permission requested for ${tool}.`]);
    }

    if (event.type === "tool_use" || event.type === "tool_result") {
      if (this.mode !== "verbatim") return [];
      const tool = typeof event.payload.tool === "string" ? event.payload.tool : "tool";
      return this.makeChunks("tool", [`Claude used ${tool}.`]);
    }

    return [];
  }

  private makeChunks(kind: SpeechChunkKind, texts: string[]): SpeechChunk[] {
    return texts.filter(Boolean).map((text) => {
      const sequence = this.nextSequence++;
      return { id: `speech-${sequence}`, sequence, kind, text };
    });
  }
}
