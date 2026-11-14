import React, { useState, useRef, useEffect } from 'react';
import { Mic, MicOff, Loader2, RefreshCw } from 'lucide-react';
import { AudioRecorder } from '../lib/audio_capture';
import { sendAudioDirect, isLocalMode } from '../lib/api';
import { speechRecognitionAvailable, startSpeechRecognition } from '../lib/speech';

interface VoiceWidgetProps {
  onSpeechRecognized: (text: string) => void;
  disabled?: boolean;
}

export const VoiceWidget: React.FC<VoiceWidgetProps> = ({ onSpeechRecognized, disabled }) => {
  // Core UI state
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [duration, setDuration] = useState(0);
  const [validation, setValidation] = useState<{ ok: boolean; errors: string[] } | null>(null);
  const [preview, setPreview] = useState<{ highQuality: Blob; lowQuality: Blob } | null>(null);

  // Refs
  const recorderRef = useRef<AudioRecorder | null>(null);
  const recognitionRef = useRef<{ stop: () => void } | null>(null);
  const usingSpeechRecognitionRef = useRef<boolean>(false);
  const timerRef = useRef<any>(null);

  // Recording timer (seconds)
  useEffect(() => {
    if (isRecording) {
      timerRef.current = setInterval(() => setDuration((d) => d + 1), 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
      setDuration(0);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isRecording]);

  const startRecording = async () => {
    // Local mode: use the browser's built-in speech recognition when available.
    if (isLocalMode && speechRecognitionAvailable()) {
      usingSpeechRecognitionRef.current = true;
      const handle = startSpeechRecognition({
        onInterim: (interim) => setStatusMessage(`Heard: "${interim}"`),
        onFinal: (text) => {
          setIsRecording(false);
          setIsProcessing(false);
          setStatusMessage(`Matched: "${text}"`);
          onSpeechRecognized(text);
        },
        onError: (message) => {
          setIsRecording(false);
          setIsProcessing(false);
          setStatusMessage(message);
        }
      });
      if (handle) {
        recognitionRef.current = handle;
        setIsRecording(true);
        setStatusMessage('Listening… press again to stop');
        setValidation(null);
        setPreview(null);
      } else {
        setIsRecording(false);
        setStatusMessage('Speech recognition could not start.');
      }
      return;
    }

    usingSpeechRecognitionRef.current = false;
    const rec = new AudioRecorder();
    const ok = await rec.start();
    if (ok) {
      recorderRef.current = rec;
      setIsRecording(true);
      setStatusMessage('Recording… press again to stop');
      setValidation(null);
      setPreview(null);
    } else {
      setStatusMessage('Microphone access was denied or unavailable.');
    }
  };

  const stopRecording = async () => {
    setIsRecording(false);
    setIsProcessing(true);
    setStatusMessage('Processing audio…');

    if (usingSpeechRecognitionRef.current) {
      if (recognitionRef.current) {
        recognitionRef.current.stop(); // onFinal sends the recognized text
      } else {
        setIsProcessing(false);
        setStatusMessage('Recognizer not initialized.');
      }
      return;
    }

    if (!recorderRef.current) {
      setStatusMessage('Recorder not initialized.');
      setIsProcessing(false);
      return;
    }

    const result = await recorderRef.current.stop();
    setValidation(result.validation);
    if (result.highQuality && result.lowQuality) {
      setPreview({ highQuality: result.highQuality, lowQuality: result.lowQuality });
    }

    if (result.validation.ok) {
      setStatusMessage('Audio looks good – sending for recognition');
      try {
        const res = await sendAudioDirect(result.lowQuality!);
        if (res.success && res.recognized_text) {
          setStatusMessage(`Matched: "${res.recognized_text}" (${Math.round(res.confidence * 100)}%)`);
          onSpeechRecognized(res.recognized_text);
        } else if (res.rejected) {
          setStatusMessage(`Rejected: ${res.reason || 'Unknown phrase / below threshold'}`);
        } else {
          setStatusMessage('Could not recognize phrase. Try again or type below.');
        }
      } catch (e) {
        setStatusMessage('Recognition request failed.');
      }
    } else {
      setStatusMessage('Audio quality issues detected – see warnings below.');
    }
    setIsProcessing(false);
  };

  const handleToggle = async () => {
    if (disabled || isProcessing) return;
    if (!isRecording) {
      await startRecording();
    } else {
      await stopRecording();
    }
  };

  const handleRetry = async () => {
    // Reset everything and start a fresh recording immediately
    setValidation(null);
    setPreview(null);
    setStatusMessage('');
    if (usingSpeechRecognitionRef.current && recognitionRef.current) {
      recognitionRef.current.stop();
    }
    if (recorderRef.current) {
      await recorderRef.current.stop(); // ensure any lingering stream is closed
    }
    await startRecording();
  };

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="flex items-center gap-2">
        <button
          onClick={handleToggle}
          disabled={disabled || isProcessing}
          className={`mic-btn ${isRecording ? 'recording' : ''}`}
          aria-label={isRecording ? 'Stop recording' : 'Start recording'}
        >
          {isProcessing ? (
            <Loader2 className="animate-spin" size={20} />
          ) : isRecording ? (
            <MicOff size={20} />
          ) : (
            <Mic size={20} />
          )}
        </button>
        {isRecording && <span className="text-sm text-red-600">{duration}s</span>}
        {validation && !validation.ok && (
          <button onClick={handleRetry} className="ml-2" aria-label="Retry recording">
            <RefreshCw size={20} />
          </button>
        )}
      </div>

      {statusMessage && (
        <span className={`text-sm ${isRecording ? 'text-red-600' : 'text-gray-600'}`}>{statusMessage}</span>
      )}

      {/* Validation warnings */}
      {validation && !validation.ok && (
        <div className="mt-2 text-red-500 space-y-1">
          {validation.errors.map((e) => (
            <p key={e}>⚠️ {e}</p>
          ))}
        </div>
      )}

      {/* Preview of both high‑quality and low‑quality audio */}
      {preview && (
        <div className="mt-3 space-y-2 w-full max-w-md">
          <div>
            <h4 className="font-medium">Master (48 kHz)</h4>
            <audio controls src={URL.createObjectURL(preview.highQuality)} className="w-full" />
          </div>
          <div>
            <h4 className="font-medium">Recognition (16 kHz)</h4>
            <audio controls src={URL.createObjectURL(preview.lowQuality)} className="w-full" />
          </div>
        </div>
      )}
    </div>
  );
};
