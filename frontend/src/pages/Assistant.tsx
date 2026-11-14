import React, { useState, useEffect, useRef } from 'react';
import { createSession, loginRole, logoutSession, sendTurn, confirmAction, cancelAction, resolveMediaUrl, isLocalMode, TurnResponse } from '../lib/api';
import { speakText, stopSpeaking } from '../lib/speech';
import { VoiceConversation } from '../components/VoiceConversation';
import { TextFallback } from '../components/TextFallback';
import { ConfirmationPanel } from '../components/ConfirmationPanel';
import { User, LogIn, LogOut, MessageSquare, Mic, Volume2 } from 'lucide-react';

interface TextTurn {
  id: string;
  sender: 'user' | 'assistant';
  text: string;
  audioUrl?: string;
  intent?: string;
  module?: string;
  timestamp: string;
}

interface AssistantProps {
  sessionId: string;
  onSessionChange: (sessionId: string) => void;
}

export const Assistant: React.FC<AssistantProps> = ({ sessionId, onSessionChange }) => {
  const [role, setRole] = useState<'public' | 'student' | 'teacher'>('public');
  const [displayName, setDisplayName] = useState<string>('Guest');
  const [loading, setLoading] = useState<boolean>(false);
  const [inputMode, setInputMode] = useState<'voice' | 'text'>('voice');
  const [loginError, setLoginError] = useState<string | null>(null);
  const [turns, setTurns] = useState<TextTurn[]>([
    {
      id: 'welcome',
      sender: 'assistant',
      text: "Hello, I'm KIT VOX. Ask about attendance, timetables, fees, holidays or leave — or tap a suggestion below.",
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    }
  ]);
  const [pendingAction, setPendingAction] = useState<any>(null);
  const textEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    textEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [turns, pendingAction]);

  const nowStamp = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const playReplyAudio = (audioUrl?: string, text?: string) => {
    if (audioUrl) {
      const audio = new Audio(resolveMediaUrl(audioUrl));
      audio.playbackRate = 1.0;
      audio.play().catch(() => {});
      return;
    }
    // No recorded WAV for this reply: speak it with the browser's voice (local mode only)
    if (isLocalMode && text) {
      speakText(text);
    }
  };

  const handleTextSend = async (text: string) => {
    setTurns((prev) => [...prev, { id: String(Date.now()), sender: 'user', text, timestamp: nowStamp() }]);
    try {
      const res: TurnResponse = await sendTurn(sessionId, text);
      setTurns((prev) => [
        ...prev,
        {
          id: String(Date.now() + 1),
          sender: 'assistant',
          text: res.assistant_text,
          audioUrl: res.audio_url,
          intent: res.intent,
          module: res.module,
          timestamp: nowStamp()
        }
      ]);
      if (res.needs_confirmation && res.pending_action) {
        setPendingAction(res.pending_action);
      } else {
        setPendingAction(null);
      }
      playReplyAudio(res.audio_url, res.assistant_text);
    } catch (e: any) {
      setTurns((prev) => [
        ...prev,
        { id: String(Date.now() + 1), sender: 'assistant', text: `⚠️ ${e.message || 'Backend error'}`, timestamp: nowStamp() }
      ]);
    }
  };

  const handleTextConfirm = async () => {
    if (!pendingAction) return;
    try {
      const res = await confirmAction(pendingAction.action_id || pendingAction.id, sessionId);
      setTurns((prev) => [
        ...prev,
        { id: String(Date.now()), sender: 'user', text: 'Confirmed.', timestamp: nowStamp() },
        { id: String(Date.now() + 1), sender: 'assistant', text: res.message || 'Action executed successfully.', audioUrl: res.audio_url, timestamp: nowStamp() }
      ]);
      setPendingAction(null);
      playReplyAudio(res.audio_url, res.message);
    } catch (e: any) {
      setTurns((prev) => [...prev, { id: String(Date.now() + 1), sender: 'assistant', text: `⚠️ ${e.message || 'Confirmation failed'}`, timestamp: nowStamp() }]);
    }
  };

  const handleTextCancel = async () => {
    if (!pendingAction) return;
    try {
      const res = await cancelAction(pendingAction.action_id || pendingAction.id, sessionId);
      setTurns((prev) => [
        ...prev,
        { id: String(Date.now()), sender: 'user', text: 'Cancelled.', timestamp: nowStamp() },
        { id: String(Date.now() + 1), sender: 'assistant', text: res.message || 'Action cancelled.', audioUrl: res.audio_url, timestamp: nowStamp() }
      ]);
      setPendingAction(null);
      playReplyAudio(res.audio_url, res.message);
    } catch (e: any) {
      setTurns((prev) => [...prev, { id: String(Date.now() + 1), sender: 'assistant', text: `⚠️ ${e.message || 'Cancellation failed'}`, timestamp: nowStamp() }]);
    }
  };

  const handleLogin = async (targetRole: 'student' | 'teacher', username?: string, password?: string) => {
    setLoading(true);
    setLoginError(null);
    try {
      const res = await loginRole(sessionId, targetRole, username, password);
      if (res.success) {
        setRole(res.role);
        setDisplayName(res.display_name);
      } else {
        setLoginError(res.detail || 'Authentication failed');
      }
    } catch (e: any) {
      setLoginError(e.message || 'Login error');
    }
    setLoading(false);
  };

  const handleLogout = async () => {
    setLoading(true);
    stopSpeaking();
    await logoutSession(sessionId);
    const sess = await createSession();
    onSessionChange(sess.session_id);
    setRole(sess.role || 'public');
    setDisplayName(sess.display_name || 'Guest');
    setLoading(false);
  };

  return (
    <div className="assistant-container">
      {/* Identity & Role Header */}
      <div className="auth-bar">
        <div className="auth-user-info">
          <User size={17} color="#5C6B77" />
          <span>Signed in as <strong>{displayName}</strong></span>
          <span className={`role-tag ${role}`}>{role.charAt(0).toUpperCase() + role.slice(1)}</span>
        </div>

        <div className="login-options">
          {role === 'public' ? (
            <>
              <button
                className="btn-secondary"
                onClick={() => handleLogin('student', 'arjun', 'Kit@2026')}
                disabled={loading}
                title="Sign in as student Arjun K"
              >
                <LogIn size={14} style={{ display: 'inline', marginRight: '4px' }} />
                Sign in as Arjun
              </button>
              <button
                className="btn-secondary"
                onClick={() => handleLogin('teacher', 'lakshmi', 'Kit@2026')}
                disabled={loading}
                title="Sign in as faculty Dr. Lakshmi"
              >
                <LogIn size={14} style={{ display: 'inline', marginRight: '4px' }} />
                Sign in as Dr. Lakshmi
              </button>
            </>
          ) : (
            <button className="btn-secondary" onClick={handleLogout} disabled={loading}>
              <LogOut size={14} style={{ display: 'inline', marginRight: '4px' }} />
              Sign out
            </button>
          )}

          {/* Mode Switcher: Voice vs Text */}
          <div className="mode-toggle-group">
            <button
              onClick={() => setInputMode('voice')}
              className={`mode-btn ${inputMode === 'voice' ? 'active' : ''}`}
            >
              <Mic size={14} /> Voice
            </button>
            <button
              onClick={() => setInputMode('text')}
              className={`mode-btn ${inputMode === 'text' ? 'active' : ''}`}
            >
              <MessageSquare size={14} /> Text
            </button>
          </div>
        </div>
      </div>

      {loginError && (
        <div className="auth-error-banner">
          ⚠️ {loginError}
        </div>
      )}

      {/* Main Experience: Primary Voice Conversation */}
      {sessionId ? (
        inputMode === 'voice' ? (
          <VoiceConversation
            sessionId={sessionId}
            role={role}
            displayName={displayName}
          />
        ) : (
          <div className="chat-window">
            <div className="p-4">
              You're typing. Switch to Voice to speak instead.
            </div>
            <TextFallback
              onSendMessage={handleTextSend}
              disabled={loading}
              role={role}
            />
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
                        <span>Voice reply available</span>
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {pendingAction && (
                <div className="pending-voice-action">
                  <ConfirmationPanel
                    summary={pendingAction.summary}
                    onConfirm={handleTextConfirm}
                    onCancel={handleTextCancel}
                    loading={loading}
                  />
                </div>
              )}
              <div ref={textEndRef} />
            </div>
          </div>
        )
      ) : (
        <div className="loading-state">Starting secure session...</div>
      )}
    </div>
  );
};
