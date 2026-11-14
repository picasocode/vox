// Backend origin: empty = same origin (single-project Vercel deploy, local dev).
// For a separately deployed backend, set VITE_API_BASE_URL at build time,
// e.g. VITE_API_BASE_URL=https://vox-api.vercel.app
const BACKEND_ORIGIN =
  (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/+$/, '') || '';

const API_BASE = `${BACKEND_ORIGIN}/api`;

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

export async function createSession() {
  const res = await fetch(`${API_BASE}/session`, { method: 'POST' });
  return await res.json();
}

export async function loginRole(
  sessionId: string,
  role: 'student' | 'teacher',
  username?: string,
  password?: string
) {
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
  const res = await fetch(`${API_BASE}/logout?session_id=${sessionId}`, { method: 'POST' });
  return await res.json();
}

export async function sendTurn(sessionId: string, text?: string, audioBase64?: string): Promise<TurnResponse> {
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
  const formData = new FormData();
  formData.append('file', audioBlob, 'mic_recording.wav');
  const res = await fetch(`${API_BASE}/asr`, {
    method: 'POST',
    body: formData
  });
  return await res.json();
}

export async function confirmAction(actionId: string, sessionId: string) {
  const res = await fetch(`${API_BASE}/actions/${actionId}/confirm?session_id=${sessionId}`, {
    method: 'POST'
  });
  return await res.json();
}

export async function cancelAction(actionId: string, sessionId: string) {
  const res = await fetch(`${API_BASE}/actions/${actionId}/cancel?session_id=${sessionId}`, {
    method: 'POST'
  });
  return await res.json();
}

export async function getHistory(sessionId: string) {
  const res = await fetch(`${API_BASE}/history?session_id=${sessionId}`);
  return await res.json();
}

export async function getPublicInfo() {
  const res = await fetch(`${API_BASE}/public/info`);
  return await res.json();
}

export async function getHealth() {
  const res = await fetch(`${API_BASE}/health`);
  return await res.json();
}
