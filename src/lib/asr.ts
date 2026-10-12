"use client";

/**
 * Thin wrapper over the browser SpeechRecognition API (Chrome's webkit prefix),
 * configured for streaming Japanese. Emits interim text as the idol speaks and
 * a final string per settled utterance. Auto-restarts on the API's frequent
 * `onend` so a long talk keeps listening.
 *
 * This is the v1 capture path (open-mic, zero audio infra). Swap the internals
 * for a server-streamed ASR (Deepgram / OpenAI Realtime) later without touching
 * the UI — keep the same handler shape.
 */

export type AsrHandlers = {
  onInterim: (text: string) => void;
  onFinal: (text: string) => void;
  onError?: (message: string) => void;
  onEnd?: () => void;
};

// Minimal structural types — the DOM lib doesn't ship SpeechRecognition.
type RecognitionAlternative = { transcript: string };
type RecognitionResult = { readonly 0: RecognitionAlternative; isFinal: boolean };
type RecognitionEvent = { resultIndex: number; results: ArrayLike<RecognitionResult> };
type RecognitionErrorEvent = { error?: string };

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: ((event: RecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
};
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function recognitionCtor(): SpeechRecognitionCtor | undefined {
  if (typeof window === "undefined") return undefined;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

export class Asr {
  private rec: SpeechRecognitionLike | null = null;
  private running = false;
  readonly supported: boolean;

  constructor(lang = "ja-JP") {
    const Ctor = recognitionCtor();
    this.supported = Boolean(Ctor);
    if (Ctor) {
      const rec = new Ctor();
      rec.lang = lang;
      rec.continuous = true;
      rec.interimResults = true;
      this.rec = rec;
    }
  }

  start(handlers: AsrHandlers): void {
    if (!this.rec) {
      handlers.onError?.("SpeechRecognition is unavailable — use Chrome, or type the line below.");
      return;
    }
    const rec = this.rec;

    rec.onresult = (event: RecognitionEvent) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        const text = result[0].transcript.trim();
        if (!text) continue;
        if (result.isFinal) handlers.onFinal(text);
        else interim += result[0].transcript;
      }
      if (interim.trim()) handlers.onInterim(interim.trim());
    };

    rec.onerror = (event: RecognitionErrorEvent) => {
      // `no-speech`/`aborted` are benign; let the restart loop handle them.
      if (event.error && event.error !== "no-speech" && event.error !== "aborted") {
        handlers.onError?.(event.error);
      }
    };

    rec.onend = () => {
      if (this.running) {
        try {
          rec.start();
        } catch {
          /* already starting */
        }
      } else {
        handlers.onEnd?.();
      }
    };

    this.running = true;
    try {
      rec.start();
    } catch {
      /* already started */
    }
  }

  stop(): void {
    this.running = false;
    try {
      this.rec?.stop();
    } catch {
      /* not running */
    }
  }
}
