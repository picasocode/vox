// KIT VOX API layer — React-only edition.
//
// The assistant now runs entirely in the browser (see localEngine.ts): sessions,
// keyword intent recognition, slot filling, confirmations and audit history all
// live in localStorage. No Python backend is required.
//
// If you later want a server-side engine, set VITE_API_BASE_URL at build time
// (e.g. VITE_API_BASE_URL=https://my-api.example.com) and every call below will
// hit that REST API using the same contract instead of the local engine.

import {
  kitEngine,
  LocalTurnResult,
  HistoryEntry
} from './localEngine';

const BACKEND_ORIGIN =
  (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/+$/, '') || '';

const API_BASE = `${BACKEND_ORIGIN}/api`;

/** True when the assistant runs fully in-browser (no backend configured). */
export const isLocalMode = BACKEND_ORIGIN === '';

/** Resolve a backend-relative media URL (e.g. /tts/reply.wav) against the backend origin. */
export function resolveMediaUrl(url: string): string {
  if (!url || /^(https?:|data:|blob:)/.test(url)) return url;
  return `${BACKEND_ORIGIN}${url}`;
}

export interface TurnResponse {
  session_id: string;
  recognized_text?: string;
  intent?: string;
  module?: string;
  assistant_text: string;
  audio_url?: string;
  pending_action?: any;
  needs_confirmation: boolean;
  context?: any;
  error?: string;
}

function turnFromLocal(res: LocalTurnResult): TurnResponse {
  return {
    session_id: res.session_id,
    recognized_text: res.recognized_text,
    intent: res.intent,
    module: res.module,
    assistant_text: res.assistant_text,
    audio_url: res.audio_url,
    pending_action: res.pending_action,
    needs_confirmation: res.needs_confirmation,
    error: res.error
  };
}

export async function createSession(): Promise<{ session_id: string; role?: 'public' | 'student' | 'teacher'; display_name?: string }> {
  if (isLocalMode) return kitEngine.createSession();
  const res = await fetch(`${API_BASE}/session`, { method: 'POST' });
  return await res.json();
}

export async function loginRole(
  sessionId: string,
  role: 'student' | 'teacher',
  username?: string,
  password?: string
) {
  if (isLocalMode) return kitEngine.loginRole(sessionId, role, username, password);
  const defaultUser = role === 'student' ? 'arjun' : 'lakshmi';
  const defaultPass = 'Kit@2026';

  const res = await fetch(`${API_BASE}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      session_id: sessionId,
      username: username || defaultUser,
      password: password || defaultPass,
      role
    })
  });
  return await res.json();
}

export async function logoutSession(sessionId: string) {
  if (isLocalMode) return kitEngine.logoutSession(sessionId);
  const res = await fetch(`${API_BASE}/logout?session_id=${sessionId}`, { method: 'POST' });
  return await res.json();
}

export async function sendTurn(sessionId: string, text?: string, audioBase64?: string): Promise<TurnResponse> {
  if (isLocalMode) return turnFromLocal(await kitEngine.sendTurn(sessionId, text, audioBase64));
  const res = await fetch(`${API_BASE}/turn`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      session_id: sessionId,
      text: text || undefined,
      audio_base64: audioBase64 || undefined
    })
  });
  return await res.json();
}

export async function sendAudioDirect(audioBlob: Blob): Promise<any> {
  if (isLocalMode) {
    return {
      success: false,
      rejected: true,
      reason:
        'Speech recognition needs a live backend. Please type your request, or use the Assistant voice mode in a Chromium browser for built-in recognition.'
    };
  }
  const formData = new FormData();
  formData.append('file', audioBlob, 'mic_recording.wav');
  const res = await fetch(`${API_BASE}/asr`, {
    method: 'POST',
    body: formData
  });
  return await res.json();
}

export async function confirmAction(actionId: string, sessionId: string) {
  if (isLocalMode) return kitEngine.confirmAction(sessionId, actionId);
  const res = await fetch(`${API_BASE}/actions/${actionId}/confirm?session_id=${sessionId}`, {
    method: 'POST'
  });
  return await res.json();
}

export async function cancelAction(actionId: string, sessionId: string) {
  if (isLocalMode) return kitEngine.cancelAction(sessionId, actionId);
  const res = await fetch(`${API_BASE}/actions/${actionId}/cancel?session_id=${sessionId}`, {
    method: 'POST'
  });
  return await res.json();
}

export async function getHistory(sessionId: string): Promise<HistoryEntry[]> {
  if (isLocalMode) return kitEngine.getHistory(sessionId);
  const res = await fetch(`${API_BASE}/history?session_id=${sessionId}`);
  return await res.json();
}

export async function getPublicInfo() {
  if (isLocalMode) return kitEngine.getPublicInfo();
  const res = await fetch(`${API_BASE}/public/info`);
  return await res.json();
}

export async function getHealth() {
  if (isLocalMode) return kitEngine.getHealth();
  const res = await fetch(`${API_BASE}/health`);
  return await res.json();
}
