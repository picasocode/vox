import React, { useState, useRef, useEffect } from 'react';
import { Mic, MicOff, Loader2, Volume2, VolumeX, RotateCcw, Square, AlertCircle, CheckCircle2, ShieldCheck } from 'lucide-react';
import { AudioRecorder, blobToBase64 } from '../lib/audio_capture';
import { sendTurn, confirmAction, cancelAction, resolveMediaUrl, TurnResponse } from '../lib/api';
import { ConfirmationPanel } from './ConfirmationPanel';

export type ConversationState =
  | 'IDLE'
  | 'LISTENING'
  | 'PROCESSING'
  | 'RESPONDING'
  | 'SPEAKING'
  | 'WAITING_FOR_CLARIFICATION'
  | 'WAITING_FOR_CONFIRMATION'
  | 'ERROR'
  | 'STOPPED';

interface ConversationTurn {
  id: string;
  sender: 'user' | 'assistant';
  text: string;
  audioUrl?: string;
  intent?: string;
  module?: string;
  timestamp: string;
}

interface VoiceConversationProps {
  sessionId: string;
  role: 'public' | 'student' | 'teacher';
  displayName: string;
  onTurnComplete?: (res: TurnResponse) => void;
}

export const VoiceConversation: React.FC<VoiceConversationProps> = ({
  sessionId,
  role,
  displayName,
  onTurnComplete
}) => {
  const [turns, setTurns] = useState<ConversationTurn[]>([
    {
      id: 'welcome',
      sender: 'assistant',
      text: "Hello, I'm KIT VOX. Ask about attendance, timetables, fees, holidays or leave — or press the microphone and just ask aloud.",
      audioUrl: '/tts/welcome.wav',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    }
  ]);

  const [state, setState] = useState<ConversationState>('IDLE');
  const [isMuted, setIsMuted] = useState(false);
  const [audioError, setAudioError] = useState<string | null>(null);
  const [statusText, setStatusText] = useState<string>('Ready for voice command');
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [pendingAction, setPendingAction] = useState<any>(null);
  const [lastAudioUrl, setLastAudioUrl] = useState<string | null>('/tts/welcome.wav');

  const recorderRef = useRef<AudioRecorder | null>(null);
  const timerRef = useRef<any>(null);
  const audioElementRef = useRef<HTMLAudioElement | null>(null);
  const conversationEndRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll
  useEffect(() => {
    conversationEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [turns, pendingAction, state]);

  // Recording timer
  useEffect(() => {
    if (state === 'LISTENING') {
      timerRef.current = setInterval(() => setRecordSeconds((s) => s + 1), 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
      setRecordSeconds(0);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [state]);

  // Audio playback handler: strictly 1.0x speed, unmuted by default
  const playVoiceResponse = (audioUrl: string, nextState: ConversationState = 'IDLE') => {
    if (isMuted) {
      setState(nextState);
      setStatusText('Assistant response ready (Audio muted)');
      return;
    }

    setAudioError(null);
    setLastAudioUrl(audioUrl);

    if (audioElementRef.current) {
      audioElementRef.current.pause();
    }

    const audio = new Audio(resolveMediaUrl(audioUrl));
    audio.playbackRate = 1.0; // Strictly 1.0x playback speed per specification
    audioElementRef.current = audio;

    setState('SPEAKING');
    setStatusText('Speaking response (1.0×)...');

    audio.onended = () => {
      setState(nextState);
      setStatusText(
        nextState === 'WAITING_FOR_CONFIRMATION'
          ? 'Awaiting your confirmation ("yes" or "no")'
          : nextState === 'WAITING_FOR_CLARIFICATION'
          ? 'Awaiting clarification details...'
          : 'Ready for your next question.'
      );
    };

    audio.onerror = (e) => {
      setState('ERROR');
      const msg = `Audio playback failed for "${audioUrl}". Click Replay to try again.`;
      setAudioError(msg);
      setStatusText('Audio error occurred.');
      console.error("Audio error:", e);
    };

    audio.play().catch((err) => {
      setState('IDLE');
      setAudioError(`Audio autoplay was restricted: ${err.message}. Click Replay to listen.`);
      setStatusText('Autoplay paused – click Replay');
    });
  };

  const stopAudio = () => {
    if (audioElementRef.current) {
      audioElementRef.current.pause();
      audioElementRef.current.currentTime = 0;
    }
    setState('STOPPED');
    setStatusText('Audio playback stopped.');
  };

  const replayAudio = () => {
    if (lastAudioUrl) {
      playVoiceResponse(lastAudioUrl, pendingAction ? 'WAITING_FOR_CONFIRMATION' : 'IDLE');
    }
  };

  const toggleMute = () => {
    const next = !isMuted;
    setIsMuted(next);
    if (next && state === 'SPEAKING') {
      stopAudio();
    }
  };

  // Start microphone capture
  const startRecording = async () => {
    if (state === 'SPEAKING') stopAudio();
    setAudioError(null);

    const rec = new AudioRecorder();
    const ok = await rec.start();
    if (ok) {
      recorderRef.current = rec;
      setState('LISTENING');
      setStatusText('Listening... Speak now.');
    } else {
      setState('ERROR');
      setStatusText('Microphone permission denied or device error.');
      setAudioError('Microphone access was denied. Please grant microphone permissions in your browser.');
    }
  };

  // Stop recording and process turn
  const stopRecordingAndSend = async () => {
    setState('PROCESSING');
    setStatusText('Recognizing speech...');

    if (!recorderRef.current) {
      setState('ERROR');
      setStatusText('Recorder not initialized.');
      return;
    }

    try {
      const recResult = await recorderRef.current.stop();
      if (!recResult.lowQuality) {
        setState('IDLE');
        setStatusText('No audio captured. Click microphone to speak.');
        return;
      }

      // Convert 16 kHz WAV blob to base64
      const base64Wav = await blobToBase64(recResult.lowQuality);

      setState('RESPONDING');
      setStatusText('Formulating agent response...');
      const res: TurnResponse = await sendTurn(sessionId, undefined, base64Wav);

      // Add user turn
      const recognized = res.recognized_text;
      const userTurn: ConversationTurn = {
        id: String(Date.now()),
        sender: 'user',
        text: recognized ? recognized : '(Speech wasn\u2019t clear enough to match a command)',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };

      // Add assistant turn
      const assistantTurn: ConversationTurn = {
        id: String(Date.now() + 1),
        sender: 'assistant',
        text: res.assistant_text,
        audioUrl: res.audio_url,
        intent: res.intent,
        module: res.module,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };

      setTurns((prev) => [...prev, userTurn, assistantTurn]);

      let nextState: ConversationState = 'IDLE';
      if (res.needs_confirmation && res.pending_action) {
        setPendingAction(res.pending_action);
        nextState = 'WAITING_FOR_CONFIRMATION';
      } else if (res.assistant_text.includes('Which date') || res.assistant_text.includes('reason')) {
        setPendingAction(null);
        nextState = 'WAITING_FOR_CLARIFICATION';
      } else {
        setPendingAction(null);
      }

      if (onTurnComplete) onTurnComplete(res);

      // Automatically play response voice
      if (res.audio_url) {
        playVoiceResponse(res.audio_url, nextState);
      } else {
        setState(nextState);
        setStatusText('Response ready');
      }
    } catch (err: any) {
      setState('ERROR');
      setStatusText('Turn processing failure.');
      setAudioError(err.message || 'Error communicating with assistant backend.');
    }
  };

  const handleMicToggle = async () => {
    if (state === 'PROCESSING' || state === 'RESPONDING') return;
    if (state !== 'LISTENING') {
      await startRecording();
    } else {
      await stopRecordingAndSend();
    }
  };

  const handleRetry = async () => {
    if (state === 'LISTENING') {
      if (recorderRef.current) await recorderRef.current.stop();
    }
    stopAudio();
    await startRecording();
  };

  // Confirmation handlers
  const handleConfirmAction = async () => {
    if (!pendingAction) return;
    setState('PROCESSING');
    setStatusText('Executing confirmed action...');
    try {
      const res = await confirmAction(pendingAction.action_id || pendingAction.id, sessionId);
      const userTurn: ConversationTurn = {
        id: String(Date.now()),
        sender: 'user',
        text: 'Confirmed.',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };
      const assistantTurn: ConversationTurn = {
        id: String(Date.now() + 1),
        sender: 'assistant',
        text: res.message || 'Action executed successfully.',
        audioUrl: res.audio_url || '/tts/action_confirmed.wav',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };
      setTurns((prev) => [...prev, userTurn, assistantTurn]);
      setPendingAction(null);
      if (res.audio_url) playVoiceResponse(res.audio_url, 'IDLE');
    } catch (e: any) {
      setState('ERROR');
      setAudioError(e.message || 'Confirmation failed');
    }
  };

  const handleCancelAction = async () => {
    if (!pendingAction) return;
    setState('PROCESSING');
    try {
      const res = await cancelAction(pendingAction.action_id || pendingAction.id, sessionId);
      const userTurn: ConversationTurn = {
        id: String(Date.now()),
        sender: 'user',
        text: 'Cancelled.',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };
      const assistantTurn: ConversationTurn = {
        id: String(Date.now() + 1),
        sender: 'assistant',
        text: res.message || 'Action cancelled.',
        audioUrl: res.audio_url || '/tts/action_cancelled.wav',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };
      setTurns((prev) => [...prev, userTurn, assistantTurn]);
      setPendingAction(null);
      if (res.audio_url) playVoiceResponse(res.audio_url, 'IDLE');
    } catch (e: any) {
      setState('ERROR');
      setAudioError(e.message || 'Cancellation failed');
    }
  };

  return (
    <div className="voice-conversation-container">
      {/* State Machine Header Banner */}
      <div className={`voice-status-bar ${state === 'LISTENING' ? 'active-listening' : state === 'SPEAKING' ? 'active-speaking' : ''}`}>
        <div className="voice-status-indicator">
          {state === 'PROCESSING' || state === 'RESPONDING' ? (
            <Loader2 className="animate-spin text-indigo-400" size={18} />
          ) : state === 'LISTENING' ? (
            <span className="pulse-dot red" />
          ) : state === 'SPEAKING' ? (
            <span className="pulse-dot green" />
          ) : state === 'WAITING_FOR_CONFIRMATION' ? (
            <ShieldCheck size={18} color="#f59e0b" />
          ) : (
            <span className="pulse-dot gray" />
          )}
          <span className="state-badge">[{state}]</span>
          <span className="status-label">{statusText}</span>
          {state === 'LISTENING' && <span className="timer-badge">{recordSeconds}s</span>}
        </div>

        {/* Audio Controls: Mute, Replay, Stop, Retry */}
        <div className="audio-controls-row">
          <button
            onClick={toggleMute}
            className={`ctrl-btn ${isMuted ? 'active-mute' : ''}`}
            title={isMuted ? 'Unmute voice playback' : 'Mute voice playback'}
          >
            {isMuted ? <VolumeX size={16} /> : <Volume2 size={16} />}
            <span>{isMuted ? 'Muted' : 'Sound'}</span>
          </button>

          {lastAudioUrl && (
            <button onClick={replayAudio} className="ctrl-btn" title="Replay assistant voice">
              <RotateCcw size={15} />
              <span>Replay</span>
            </button>
          )}

          {state === 'SPEAKING' && (
            <button onClick={stopAudio} className="ctrl-btn stop" title="Stop audio playback">
              <Square size={14} />
              <span>Stop</span>
            </button>
          )}

          <button onClick={handleRetry} className="ctrl-btn" title="Retry voice command">
            <RotateCcw size={15} />
            <span>Retry</span>
          </button>
        </div>
      </div>

      {/* Audio Error Alert with Replay */}
      {audioError && (
        <div className="audio-error-banner">
          <AlertCircle size={18} color="#ef4444" />
          <span className="error-text">{audioError}</span>
          {lastAudioUrl && (
            <button onClick={replayAudio} className="btn-retry-audio">
              Replay Audio
            </button>
          )}
        </div>
      )}

      {/* Conversation Turns Display */}
      <div className="voice-transcript-area">
        {turns.map((turn) => (
          <div key={turn.id} className={`voice-bubble-wrapper ${turn.sender}`}>
            <div className={`voice-bubble ${turn.sender}`}>
              <div className="bubble-header">
                <span className="sender-tag">
                  {turn.sender === 'user' ? 'You' : 'KIT VOX'}
                </span>
                <span className="timestamp">{turn.timestamp}</span>
              </div>
              <div className="bubble-body">{turn.text}</div>
              {turn.audioUrl && (
                <div className="bubble-audio-badge">
                  <Volume2 size={12} />
                  <span>Spoken reply</span>
                </div>
              )}
            </div>
          </div>
        ))}

        {/* Pending Action Confirmation Panel */}
        {pendingAction && (
          <div className="pending-voice-action">
            <ConfirmationPanel
              summary={pendingAction.summary}
              onConfirm={handleConfirmAction}
              onCancel={handleCancelAction}
              loading={state === 'PROCESSING'}
            />
          </div>
        )}

        <div ref={conversationEndRef} />
      </div>

      {/* Central Voice Action Trigger */}
      <div className="voice-footer-action">
        <button
          onClick={handleMicToggle}
          disabled={state === 'PROCESSING' || state === 'RESPONDING'}
          className={`big-voice-btn ${state === 'LISTENING' ? 'recording' : ''}`}
          aria-label={state === 'LISTENING' ? 'Stop listening' : 'Start voice command'}
        >
          {state === 'PROCESSING' || state === 'RESPONDING' ? (
            <Loader2 className="animate-spin" size={32} />
          ) : state === 'LISTENING' ? (
            <MicOff size={32} />
          ) : (
            <Mic size={32} />
          )}
        </button>
        <span className="voice-instruction">
          {state === 'LISTENING'
            ? 'Listening — press the microphone when you finish'
            : state === 'SPEAKING'
            ? 'Speaking — press Stop to interrupt'
            : 'Press the microphone and speak'}
        </span>
      </div>
    </div>
  );
};
