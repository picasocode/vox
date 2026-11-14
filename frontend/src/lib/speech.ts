// Web Speech API helpers — pure browser speech recognition (Chrome/Edge/Safari)
// and speech synthesis, so voice input/output works without any backend.

// Minimal TypeScript declarations for the Web Speech API (not in lib.dom).
interface SpeechRecognitionAlternativeLike {
  transcript: string;
  confidence: number;
}
interface SpeechRecognitionResultLike {
  isFinal: boolean;
  length: number;
  [index: number]: SpeechRecognitionAlternativeLike;
}
interface SpeechRecognitionResultListLike {
  length: number;
  [index: number]: SpeechRecognitionResultLike;
}
interface SpeechRecognitionEventLike extends Event {
  resultIndex: number;
  results: SpeechRecognitionResultListLike;
}
interface SpeechRecognitionErrorEventLike extends Event {
  error: string;
  message?: string;
}
interface SpeechRecognitionLike extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((ev: SpeechRecognitionEventLike) => void) | null;
  onerror: ((ev: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getRecognitionCtor(): SpeechRecognitionCtor | null {
  const w = window as any;
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

export function speechRecognitionAvailable(): boolean {
  return typeof window !== 'undefined' && !!getRecognitionCtor();
}

export interface RecognitionHandlers {
  onInterim?: (text: string) => void;
  onFinal: (text: string) => void;
  onError?: (message: string) => void;
  onEnd?: () => void;
}

/** Start one-shot speech recognition. Returns a handle with stop(). */
export function startSpeechRecognition(handlers: RecognitionHandlers): { stop: () => void } | null {
  const Ctor = getRecognitionCtor();
  if (!Ctor) return null;

  const rec = new Ctor();
  rec.lang = 'en-US';
  rec.continuous = false;
  rec.interimResults = true;
  rec.maxAlternatives = 1;

  let finalText = '';
  let finished = false;

  rec.onresult = (ev: SpeechRecognitionEventLike) => {
    let interim = '';
    for (let i = ev.resultIndex; i < ev.results.length; i++) {
      const result = ev.results[i];
      const alt = result[0];
      if (result.isFinal) {
        finalText += alt.transcript;
      } else {
        interim += alt.transcript;
      }
    }
    if (interim && handlers.onInterim) handlers.onInterim(interim);
  };

  rec.onerror = (ev: SpeechRecognitionErrorEventLike) => {
    if (finished) return;
    finished = true;
    const map: Record<string, string> = {
      'not-allowed': 'Microphone permission was denied for speech recognition.',
      'service-not-allowed': 'Speech recognition service is not allowed on this page.',
      'no-speech': 'No speech was detected. Try again.',
      'audio-capture': 'No microphone was found.',
      network: 'Speech recognition network error. Try again.'
    };
    if (handlers.onError) handlers.onError(map[ev.error] || `Speech recognition error: ${ev.error}`);
    if (handlers.onEnd) handlers.onEnd();
  };

  rec.onend = () => {
    if (finished) return;
    finished = true;
    const text = finalText.trim();
    if (text) {
      handlers.onFinal(text);
    } else if (handlers.onError) {
      handlers.onError('No speech was detected. Try again.');
    }
    if (handlers.onEnd) handlers.onEnd();
  };

  try {
    rec.start();
  } catch (e) {
    if (handlers.onError) handlers.onError('Speech recognition could not start. Try again.');
    return null;
  }

  return {
    stop: () => {
      try {
        rec.stop();
      } catch (e) {
        /* already stopped */
      }
    }
  };
}

/** Speak text via the browser's speech synthesis (returns true if it spoke). */
export function speakText(text: string, onEnd?: () => void): boolean {
  if (typeof window === 'undefined' || !('speechSynthesis' in window) || !text) {
    if (onEnd) onEnd();
    return false;
  }
  try {
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.rate = 1.0;
    utter.pitch = 1.0;
    utter.volume = 1.0;
    utter.lang = 'en-US';
    if (onEnd) {
      utter.onend = () => onEnd();
      utter.onerror = () => onEnd();
    }
    window.speechSynthesis.speak(utter);
    return true;
  } catch (e) {
    if (onEnd) onEnd();
    return false;
  }
}

export function stopSpeaking(): void {
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    try {
      window.speechSynthesis.cancel();
    } catch (e) {
      /* noop */
    }
  }
}
