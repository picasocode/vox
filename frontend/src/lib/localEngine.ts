// In-browser KIT VOX engine — a pure React/TypeScript port of the Python backend.
// Implements the exact API contract the UI consumes: sessions, role login,
// keyword intent recognition, multi-slot flows (leave / on-duty / approvals),
// confirmation gates, audit history and pre-recorded voice reply URLs.
// Everything persists in localStorage (with an in-memory fallback) so the app
// runs entirely client-side with no server.

import {
  COLLEGE_INFO,
  COURSES,
  HOLIDAYS,
  EXAMS,
  PLACEMENT_DRIVES,
  MIN_ATTENDANCE_PCT,
  STUDENT_PROFILE,
  TEACHER_PROFILE,
  DEMO_ACCOUNTS,
  INITIAL_PENDING_REQUESTS,
  TTS,
  StudentRequest,
  PendingRequest
} from './kitData';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Role = 'public' | 'student' | 'teacher';

export interface LocalSession {
  session_id: string;
  role: Role;
  display_name: string;
  awaiting_slot: null | 'date' | 'reason' | 'event_name' | 'request_id';
  flow: null | 'leave' | 'od' | 'approve' | 'reject';
  slots: Record<string, string>;
  pending_action: PendingAction | null;
}

export interface PendingAction {
  action_id: string;
  tool_name: 'submit_leave' | 'submit_on_duty' | 'approve_request' | 'reject_request';
  intent: string;
  slots: Record<string, string>;
  summary: string;
}

export interface LocalTurnResult {
  session_id: string;
  recognized_text?: string;
  intent?: string;
  module?: string;
  assistant_text: string;
  audio_url?: string;
  pending_action?: PendingAction;
  needs_confirmation: boolean;
  error?: string;
}

export interface HistoryEntry {
  created_at: string;
  intent: string;
  module: string;
  user_text: string;
  assistant_text: string;
}

// ---------------------------------------------------------------------------
// Storage (localStorage with in-memory fallback)
// ---------------------------------------------------------------------------

const STORE_KEY = 'kit_vox_local_store_v1';

interface StoreShape {
  sessions: Record<string, LocalSession>;
  history: Record<string, HistoryEntry[]>;
  pending_requests: PendingRequest[];
  student_requests: StudentRequest[];
}

let memoryStore: StoreShape | null = null;

function newStore(): StoreShape {
  return {
    sessions: {},
    history: {},
    pending_requests: INITIAL_PENDING_REQUESTS.map((r) => ({ ...r })),
    student_requests: STUDENT_PROFILE.requests.map((r) => ({ ...r }))
  };
}

function loadStore(): StoreShape {
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as StoreShape;
        // Reset pending queue if a previous version left it missing.
        return { ...newStore(), ...parsed };
      }
    }
  } catch (e) {
    /* fall through to memory */
  }
  if (!memoryStore) memoryStore = newStore();
  return memoryStore;
}

function saveStore(store: StoreShape): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORE_KEY, JSON.stringify(store));
      return;
    }
  } catch (e) {
    /* fall through to memory */
  }
  memoryStore = store;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

/** Resolve "today" / "tomorrow" / YYYY-MM-DD to an ISO date (local time). */
function resolveDateExpr(expr: string): string | null {
  const cleaned = expr.trim().toLowerCase();
  const d = new Date();
  if (cleaned === 'today') {
    return toIso(d);
  }
  if (cleaned === 'tomorrow') {
    d.setDate(d.getDate() + 1);
    return toIso(d);
  }
  const iso = cleaned.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return cleaned;
  const dmy = cleaned.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})$/);
  if (dmy) {
    return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
  }
  return null;
}

function toIso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/[?!.!,]/g, ' ').replace(/\s+/g, ' ').trim();
}

function hasAny(text: string, words: string[]): boolean {
  return words.some((w) => text.includes(w));
}

/** Port of the synthesizer's intent → pre-recorded WAV mapping. */
function audioFor(
  intent: string | undefined,
  text: string,
  needsConfirmation: boolean
): string | undefined {
  const t = text.toLowerCase();

  if (needsConfirmation) {
    if (t.includes('leave')) return TTS.confirm_leave;
    if (t.includes('duty') || t.includes(' od')) return TTS.confirm_od;
    if (t.includes('approve')) return TTS.confirm_approve;
    if (t.includes('reject')) return TTS.confirm_reject;
  }

  if (t.includes('which date do you need leave')) return TTS.leave_date_prompt;
  if (t.includes('what is the reason for your leave')) return TTS.leave_reason_prompt;
  if (t.includes('which date do you need on-duty')) return TTS.od_date_prompt;
  if (t.includes('what is the event')) return TTS.od_event_prompt;
  if (t.includes('which request id')) return TTS.request_id_prompt;

  const intentMap: Record<string, string> = {
    GET_ATTENDANCE: TTS.get_attendance,
    GET_TIMETABLE: TTS.get_timetable,
    GET_MY_REQUESTS: TTS.get_my_requests,
    LIST_PENDING: TTS.list_pending,
    CONFIRM_ACTION: TTS.action_confirmed,
    CANCEL_ACTION: TTS.action_cancelled,
    GET_COLLEGE_INFO: TTS.college_info,
    GET_COURSES: TTS.get_courses,
    GET_FEES: TTS.get_courses,
    GET_PLACEMENTS: TTS.get_courses,
    GET_ELIGIBILITY: TTS.get_eligibility,
    GET_HOLIDAYS: TTS.get_holidays,
    GET_EXAM_DATES: TTS.get_exam_dates,
    MIN_ATTENDANCE: TTS.get_attendance,
    UNKNOWN: TTS.unknown
  };
  if (intent && intentMap[intent]) return intentMap[intent];

  if (t.includes('log in') || t.includes('sign in')) return TTS.login_required;
  if (t.includes("didn't catch") || t.includes('repeat')) return TTS.repeat_prompt;
  if (t.includes('cancelled')) return TTS.action_cancelled;
  if (t.includes('blocked') || t.includes('could not')) return TTS.error;
  return undefined;
}

function requestBundleSummary(requests: StudentRequest[]): string {
  if (requests.length === 0) return 'You have no active or past requests recorded.';
  return `Here are your requests: ${requests
    .map((r) => `[${r.id}] ${r.type} on ${r.date} (${r.status})`)
    .join('; ')}.`;
}

// ---------------------------------------------------------------------------
// The engine
// ---------------------------------------------------------------------------

export class KitLocalEngine {
  private store: StoreShape;

  constructor() {
    this.store = loadStore();
  }

  private persist() {
    saveStore(this.store);
  }

  private session(sessionId: string): LocalSession {
    if (!this.store.sessions[sessionId]) {
      this.store.sessions[sessionId] = {
        session_id: sessionId,
        role: 'public',
        display_name: 'Guest',
        awaiting_slot: null,
        flow: null,
        slots: {},
        pending_action: null
      };
      this.persist();
    }
    return this.store.sessions[sessionId];
  }

  // -- Session lifecycle ----------------------------------------------------

  async createSession(): Promise<{ session_id: string; role: Role; display_name: string }> {
    const sessionId = makeId('sess');
    this.session(sessionId);
    return { session_id: sessionId, role: 'public', display_name: 'Guest' };
  }

  async loginRole(
    sessionId: string,
    role: 'student' | 'teacher',
    username?: string,
    password?: string
  ): Promise<{ success: boolean; role?: Role; display_name?: string; detail?: string }> {
    const sess = this.session(sessionId);
    const user = (username || '').trim().toLowerCase();
    const pass = password || '';
    const acct = (DEMO_ACCOUNTS as any)[role];

    if (!acct.login_ids.includes(user) || pass !== acct.password) {
      return { success: false, detail: 'Invalid login credentials' };
    }

    sess.role = role;
    sess.display_name = acct.display_name;
    sess.awaiting_slot = null;
    sess.flow = null;
    sess.slots = {};
    sess.pending_action = null;
    this.persist();
    return { success: true, role, display_name: acct.display_name };
  }

  async logoutSession(sessionId: string): Promise<{ success: boolean }> {
    const sess = this.session(sessionId);
    sess.role = 'public';
    sess.display_name = 'Guest';
    sess.awaiting_slot = null;
    sess.flow = null;
    sess.slots = {};
    sess.pending_action = null;
    this.persist();
    return { success: true };
  }

  // -- Public info ----------------------------------------------------------

  async getPublicInfo(): Promise<any> {
    return {
      college: {
        name: COLLEGE_INFO.name,
        location: COLLEGE_INFO.location,
        helpline: COLLEGE_INFO.helpline,
        email: COLLEGE_INFO.email
      },
      courses: COURSES.map((c) => ({
        title: c.title,
        duration: c.duration,
        annual_fee: c.annual_fee,
        eligibility: c.eligibility
      })),
      placements: PLACEMENT_DRIVES.map((d) => ({
        company: d.company,
        category: d.category,
        min_cgpa: d.min_cgpa,
        departments: d.allowed_departments,
        deadline: d.deadline,
        seats_left: d.seats_left,
        seats_total: d.seats_total
      })),
      today: { date: toIso(new Date()), weekday_name: new Date().toLocaleDateString('en-US', { weekday: 'long' }) }
    };
  }

  async getHealth(): Promise<{ status: string; engine: string; tts_assets: number }> {
    return { status: 'ok', engine: 'in-browser', tts_assets: Object.keys(TTS).length };
  }

  // -- History --------------------------------------------------------------

  async getHistory(sessionId: string): Promise<HistoryEntry[]> {
    return this.store.history[sessionId] || [];
  }

  private logTurn(sessionId: string, entry: HistoryEntry) {
    if (!this.store.history[sessionId]) this.store.history[sessionId] = [];
    this.store.history[sessionId].push(entry);
    if (this.store.history[sessionId].length > 200) {
      this.store.history[sessionId] = this.store.history[sessionId].slice(-200);
    }
  }

  // -- Confirmation ----------------------------------------------------------

  async confirmAction(sessionId: string, actionId: string): Promise<{ message: string; audio_url?: string }> {
    const sess = this.session(sessionId);
    const action = sess.pending_action;
    if (!action || action.action_id !== actionId) {
      return { message: 'There is no pending action to confirm.', audio_url: TTS.error };
    }

    let message = 'Action executed successfully.';
    if (action.tool_name === 'submit_leave') {
      const reqId = `REQ-${Math.floor(1000 + Math.random() * 9000)}`;
      const req: StudentRequest = {
        id: reqId,
        type: 'LEAVE',
        date: action.slots.date,
        reason: action.slots.reason,
        status: 'PENDING'
      };
      this.store.student_requests.unshift(req);
      this.store.pending_requests.unshift({
        id: reqId,
        student_id: sess.role === 'student' ? '76' : '',
        student_name: sess.display_name,
        type: 'LEAVE',
        date: action.slots.date,
        reason: action.slots.reason,
        status: 'PENDING'
      });
      message = `Confirmed. Leave request for ${action.slots.date} submitted successfully (ID: ${reqId}).`;
    } else if (action.tool_name === 'submit_on_duty') {
      const reqId = `REQ-${Math.floor(1000 + Math.random() * 9000)}`;
      const req: StudentRequest = {
        id: reqId,
        type: 'ON_DUTY',
        date: action.slots.date,
        reason: action.slots.event_name,
        status: 'PENDING'
      };
      this.store.student_requests.unshift(req);
      this.store.pending_requests.unshift({
        id: reqId,
        student_id: sess.role === 'student' ? '76' : '',
        student_name: sess.display_name,
        type: 'ON_DUTY',
        date: action.slots.date,
        reason: action.slots.event_name,
        status: 'PENDING'
      });
      message = `Confirmed. On-Duty request for ${action.slots.date} (${action.slots.event_name}) submitted successfully (ID: ${reqId}).`;
    } else if (action.tool_name === 'approve_request' || action.tool_name === 'reject_request') {
      const targetId = action.slots.request_id;
      const target = this.store.pending_requests.find(
        (r) => r.id.toUpperCase() === targetId.toUpperCase() || r.id.replace('REQ-', '') === targetId.replace('REQ-', '')
      );
      if (!target) {
        sess.pending_action = null;
        this.persist();
        return { message: `Request ${targetId} was not found.`, audio_url: TTS.error };
      }
      if (action.tool_name === 'approve_request') {
        target.status = 'APPROVED';
        target.reviewed_by = sess.display_name;
        message = `Request ${target.id} approved.`;
      } else {
        target.status = 'REJECTED';
        target.reviewed_by = sess.display_name;
        message = `Request ${target.id} rejected.`;
      }
    }

    sess.pending_action = null;
    sess.awaiting_slot = null;
    sess.flow = null;
    sess.slots = {};
    this.persist();
    return { message, audio_url: TTS.action_confirmed };
  }

  async cancelAction(sessionId: string, actionId: string): Promise<{ message: string; audio_url?: string }> {
    const sess = this.session(sessionId);
    sess.pending_action = null;
    sess.awaiting_slot = null;
    sess.flow = null;
    sess.slots = {};
    this.persist();
    return { message: 'The action was cancelled. What else can I help you with?', audio_url: TTS.action_cancelled };
  }

  // -- Main turn -------------------------------------------------------------

  async sendTurn(sessionId: string, text?: string, audioBase64?: string): Promise<LocalTurnResult> {
    const sess = this.session(sessionId);

    // Audio-only turn: no speech backend in React-only mode.
    if (!text && audioBase64) {
      const msg =
        'Microphone speech recognition is not available in this browser session. Please type your request in the text box, or use a Chromium-based browser for built-in speech recognition.';
      const res: LocalTurnResult = {
        session_id: sessionId,
        intent: 'UNKNOWN',
        module: 'asr',
        assistant_text: msg,
        audio_url: TTS.repeat_prompt,
        needs_confirmation: false
      };
      this.logTurn(sessionId, {
        created_at: nowIso(),
        intent: 'AUDIO_TURN',
        module: 'asr',
        user_text: '(voice recording)',
        assistant_text: msg
      });
      this.persist();
      return res;
    }

    const raw = (text || '').trim();
    const norm = normalize(raw);

    // --- Slot-filling flows -------------------------------------------------
    if (sess.awaiting_slot) {
      const handled = this.handleSlotInput(sess, raw, norm);
      this.persist();
      this.logTurn(sessionId, {
        created_at: nowIso(),
        intent: sess.flow ? sess.flow.toUpperCase() : 'SLOT',
        module: sess.flow === 'approve' || sess.flow === 'reject' ? 'teacher' : 'student',
        user_text: raw,
        assistant_text: handled.assistant_text
      });
      return handled;
    }

    // --- Pending action: yes / no -------------------------------------------
    if (sess.pending_action) {
      if (hasAny(norm, ['yes', 'yeah', 'ok', 'okay', 'sure', 'confirm', 'go ahead', 'please do', 'submit it', 'approve it'])) {
        const result = await this.confirmAction(sessionId, sess.pending_action.action_id);
        this.logTurn(sessionId, {
          created_at: nowIso(),
          intent: 'CONFIRM_ACTION',
          module: 'orchestrator',
          user_text: raw,
          assistant_text: result.message
        });
        this.persist();
        return {
          session_id: sessionId,
          intent: 'CONFIRM_ACTION',
          module: 'orchestrator',
          assistant_text: result.message,
          audio_url: result.audio_url,
          needs_confirmation: false
        };
      }
      if (hasAny(norm, ['no', 'cancel', 'stop', 'abort', 'don\'t', 'dont', 'never mind', 'nevermind'])) {
        const result = await this.cancelAction(sessionId, sess.pending_action.action_id);
        this.logTurn(sessionId, {
          created_at: nowIso(),
          intent: 'CANCEL_ACTION',
          module: 'orchestrator',
          user_text: raw,
          assistant_text: result.message
        });
        this.persist();
        return {
          session_id: sessionId,
          intent: 'CANCEL_ACTION',
          module: 'orchestrator',
          assistant_text: result.message,
          audio_url: result.audio_url,
          needs_confirmation: false
        };
      }
    }

    // --- Intent recognition ---------------------------------------------------
    const intent = this.matchIntent(norm);

    // Inline request id for "Approve request REQ-9012"
    if (intent === 'APPROVE_REQUEST' || intent === 'REJECT_REQUEST') {
      const idMatch = raw.match(/REQ[-\s]?\d+|\b\d{1,6}\b/i);
      if (idMatch) {
        sess.slots.request_id = idMatch[0].toUpperCase().replace(/\s+/g, '-');
      }
    }

    const result = this.dispatchIntent(sess, intent, norm, raw);
    this.persist();
    this.logTurn(sessionId, {
      created_at: nowIso(),
      intent: result.intent || intent,
      module: result.module || 'orchestrator',
      user_text: raw,
      assistant_text: result.assistant_text
    });
    return result;
  }

  // -- Slot handling -----------------------------------------------------------

  private handleSlotInput(sess: LocalSession, raw: string, norm: string): LocalTurnResult {
    const moduleId = sess.flow === 'approve' || sess.flow === 'reject' ? 'teacher' : 'student';
    const base = { session_id: sess.session_id, module: moduleId, needs_confirmation: false };

    // User aborted a flow
    if (hasAny(norm, ['cancel', 'stop', 'never mind', 'nevermind', 'forget it'])) {
      sess.awaiting_slot = null;
      sess.flow = null;
      sess.slots = {};
      return { ...base, intent: 'CANCEL_ACTION', assistant_text: 'The action was cancelled. What else can I help you with?', audio_url: TTS.action_cancelled };
    }

    if (sess.awaiting_slot === 'date') {
      const resolved = resolveDateExpr(raw);
      if (!resolved) {
        return {
          ...base,
          intent: 'SLOT_DATE',
          assistant_text:
            sess.flow === 'leave'
              ? 'Which date do you need leave for? You can say today or tomorrow, or give a date like 2026-11-30.'
              : 'Which date do you need On-Duty for? You can say today or tomorrow, or give a date like 2026-11-30.',
          audio_url: sess.flow === 'leave' ? TTS.leave_date_prompt : TTS.od_date_prompt
        };
      }
      sess.slots.date = resolved;
      sess.awaiting_slot = null;
      if (sess.flow === 'leave') {
        sess.awaiting_slot = 'reason';
        return {
          ...base,
          intent: 'SLOT_REASON',
          assistant_text: `What is the reason for your leave on ${resolved}?`,
          audio_url: TTS.leave_reason_prompt
        };
      }
      sess.awaiting_slot = 'event_name';
      return {
        ...base,
        intent: 'SLOT_EVENT',
        assistant_text: `What is the event or symposium name for your On-Duty on ${resolved}?`,
        audio_url: TTS.od_event_prompt
      };
    }

    if (sess.awaiting_slot === 'reason') {
      const reason = raw.replace(/^(the\s+)?reason\s+is\s*/i, '').trim();
      if (!reason) {
        return {
          ...base,
          intent: 'SLOT_REASON',
          assistant_text: 'What is the reason for your leave?',
          audio_url: TTS.leave_reason_prompt
        };
      }
      // Deterministic policy check: exam conflict
      const conflict = EXAMS.find((e) => e.date === sess.slots.date);
      if (conflict) {
        sess.awaiting_slot = null;
        sess.flow = null;
        sess.slots = {};
        return {
          ...base,
          intent: 'SUBMIT_LEAVE',
          assistant_text: `Leave request blocked: there is a scheduled exam on ${conflict.date} (${conflict.subject}). Please choose a different date.`,
          audio_url: TTS.error
        };
      }
      const action: PendingAction = {
        action_id: makeId('act'),
        tool_name: 'submit_leave',
        intent: 'SUBMIT_LEAVE',
        slots: { date: sess.slots.date, reason },
        summary: `Leave request for ${sess.slots.date} due to '${reason}'`
      };
      sess.pending_action = action;
      sess.awaiting_slot = null;
      sess.flow = null;
      return {
        ...base,
        intent: 'SUBMIT_LEAVE',
        assistant_text: `You are requesting leave for ${sess.slots.date} because of ${reason}. Shall I submit this request?`,
        audio_url: TTS.confirm_leave,
        pending_action: action,
        needs_confirmation: true
      };
    }

    if (sess.awaiting_slot === 'event_name') {
      const event = raw.replace(/^(the\s+)?event\s+is\s*/i, '').trim();
      if (!event) {
        return {
          ...base,
          intent: 'SLOT_EVENT',
          assistant_text: 'What is the event name for your On-Duty?',
          audio_url: TTS.od_event_prompt
        };
      }
      const conflict = EXAMS.find((e) => e.date === sess.slots.date);
      if (conflict) {
        sess.awaiting_slot = null;
        sess.flow = null;
        sess.slots = {};
        return {
          ...base,
          intent: 'SUBMIT_ON_DUTY',
          assistant_text: `On-Duty request blocked: there is a scheduled exam on ${conflict.date} (${conflict.subject}). Please choose a different date.`,
          audio_url: TTS.error
        };
      }
      const action: PendingAction = {
        action_id: makeId('act'),
        tool_name: 'submit_on_duty',
        intent: 'SUBMIT_ON_DUTY',
        slots: { date: sess.slots.date, event_name: event },
        summary: `On-Duty request for ${sess.slots.date} for event '${event}'`
      };
      sess.pending_action = action;
      sess.awaiting_slot = null;
      sess.flow = null;
      return {
        ...base,
        intent: 'SUBMIT_ON_DUTY',
        assistant_text: `You are requesting On-Duty for ${sess.slots.date} for '${event}'. Shall I submit this request?`,
        audio_url: TTS.confirm_od,
        pending_action: action,
        needs_confirmation: true
      };
    }

    if (sess.awaiting_slot === 'request_id') {
      const m = raw.match(/REQ[-\s]?\d+|\b\d{1,6}\b/i);
      if (!m) {
        return {
          ...base,
          intent: 'SLOT_REQUEST_ID',
          assistant_text: 'Which request ID would you like to review? For example REQ-9012 or 35.',
          audio_url: TTS.request_id_prompt
        };
      }
      // Keep the id exactly as the teacher typed/said it (the backend echoed it verbatim too).
      const id = m[0].toUpperCase().replace(/\s+/g, '-');
      sess.slots.request_id = id;
      sess.awaiting_slot = null;
      const isApprove = sess.flow === 'approve';
      const action: PendingAction = {
        action_id: makeId('act'),
        tool_name: isApprove ? 'approve_request' : 'reject_request',
        intent: isApprove ? 'APPROVE_REQUEST' : 'REJECT_REQUEST',
        slots: { request_id: id, action: isApprove ? 'APPROVE' : 'REJECT' },
        summary: `${isApprove ? 'Approve' : 'Reject'} student request ${id}`
      };
      sess.pending_action = action;
      sess.flow = null;
      return {
        ...base,
        intent: action.intent,
        assistant_text: `You are about to ${isApprove ? 'approve' : 'reject'} request ${id}. Do you confirm this action?`,
        audio_url: isApprove ? TTS.confirm_approve : TTS.confirm_reject,
        pending_action: action,
        needs_confirmation: true
      };
    }

    return { ...base, intent: 'UNKNOWN', assistant_text: "I didn't recognize that command. You can ask for attendance, timetable, exam dates, or submit leave.", audio_url: TTS.unknown };
  }

  // -- Intent matching -----------------------------------------------------------

  private matchIntent(norm: string): string {
    if (hasAny(norm, ['minimum attendance', 'attendance requirement', 'attendance policy'])) return 'MIN_ATTENDANCE';
    if (hasAny(norm, ['my request', 'my leave', 'my od', 'my on duty', 'my on-duty', 'request status'])) return 'GET_MY_REQUESTS';
    if (hasAny(norm, ['attendance'])) return 'GET_ATTENDANCE';
    if (hasAny(norm, ['timetable', 'time table', 'schedule', 'class plan'])) return 'GET_TIMETABLE';
    if (hasAny(norm, ['holiday', 'holidays', 'vacation'])) return 'GET_HOLIDAYS';
    if (hasAny(norm, ['exam', 'midterm', 'test date', 'examination'])) return 'GET_EXAM_DATES';
    if (hasAny(norm, ['pending'])) return 'LIST_PENDING';
    if (hasAny(norm, ['approve'])) return 'APPROVE_REQUEST';
    if (hasAny(norm, ['reject', 'decline'])) return 'REJECT_REQUEST';
    if (hasAny(norm, ['on duty', 'on-duty', ' od ']) || norm.startsWith('od') || norm === 'od') return 'SUBMIT_ON_DUTY';
    if (hasAny(norm, ['leave', 'absent', 'day off', 'sick'])) return 'SUBMIT_LEAVE';
    if (hasAny(norm, ['fee', 'fees', 'cost', 'tuition', 'salary'])) return 'GET_FEES';
    if (hasAny(norm, ['placement', 'recruit', 'drive', 'internship'])) return 'GET_PLACEMENTS';
    if (hasAny(norm, ['admission', 'eligib', 'requirement', 'criteria', 'cutoff', 'cut off'])) return 'GET_ELIGIBILITY';
    if (hasAny(norm, ['course', 'program', 'programme', 'degree', 'branch', 'offer'])) return 'GET_COURSES';
    if (hasAny(norm, ['college', 'institute', 'about kit', 'about the college', 'tell me about'])) return 'GET_COLLEGE_INFO';
    return 'UNKNOWN';
  }

  // -- Intent dispatch -------------------------------------------------------------

  private dispatchIntent(sess: LocalSession, intent: string, norm: string, raw: string): LocalTurnResult {
    const sessionId = sess.session_id;
    const base = { session_id: sessionId, intent, needs_confirmation: false };

    const loginRequired = (who: string, module: string): LocalTurnResult => ({
      ...base,
      module,
      assistant_text:
        who === 'student'
          ? 'Please log in with your student account first to access your personal student records.'
          : 'Please log in with an authorized teacher account to access faculty workflows.',
      audio_url: TTS.login_required
    });

    switch (intent) {
      // ----- Public / admissions -----
      case 'GET_COLLEGE_INFO':
        return {
          ...base,
          module: 'admissions',
          assistant_text: `${COLLEGE_INFO.name} (${COLLEGE_INFO.accreditation}). Motto: '${COLLEGE_INFO.motto}'. Located at ${COLLEGE_INFO.location}. Contact: ${COLLEGE_INFO.helpline} | ${COLLEGE_INFO.email}.`,
          audio_url: TTS.college_info
        };
      case 'GET_COURSES':
      case 'GET_FEES': {
        const list = COURSES.map((c) => `${c.title} (Fee: ${c.annual_fee}/year, ${c.seats} seats)`).join('; ');
        return { ...base, module: 'admissions', assistant_text: `KIT offers the following programs: ${list}.`, audio_url: TTS.get_courses };
      }
      case 'GET_ELIGIBILITY': {
        const list = COURSES.map((c) => `${c.code}: ${c.eligibility}`).join('; ');
        return { ...base, module: 'admissions', assistant_text: `KIT Admission Requirements: ${list}.`, audio_url: TTS.get_eligibility };
      }
      case 'GET_PLACEMENTS': {
        const list = PLACEMENT_DRIVES.map(
          (d) => `${d.company} (${d.category === 'dream' ? 'Dream offer' : 'Regular'}, min CGPA ${d.min_cgpa}, deadline ${d.deadline}, ${d.seats_left} of ${d.seats_total} seats left)`
        ).join('; ');
        return { ...base, module: 'admissions', assistant_text: `Upcoming placement drives: ${list}.`, audio_url: TTS.get_courses };
      }
      case 'GET_HOLIDAYS': {
        const list = HOLIDAYS.map((h) => `${h.name} (${h.date})`).join(', ');
        return { ...base, module: 'admissions', assistant_text: `Upcoming college holidays: ${list}.`, audio_url: TTS.get_holidays };
      }
      case 'GET_EXAM_DATES': {
        const list = EXAMS.map((e) => `${e.subject} on ${e.date} (${e.time})`).join('; ');
        return { ...base, module: 'admissions', assistant_text: `Official examination schedule: ${list}.`, audio_url: TTS.get_exam_dates };
      }
      case 'MIN_ATTENDANCE':
        return {
          ...base,
          module: 'admissions',
          assistant_text: `KIT requires a minimum of ${MIN_ATTENDANCE_PCT}% overall attendance to remain eligible for examinations.`,
          audio_url: TTS.get_attendance
        };

      // ----- Student -----
      case 'GET_ATTENDANCE': {
        if (sess.role !== 'student') return loginRequired('student', 'student');
        const b = STUDENT_PROFILE.attendance_breakdown.map((s) => `${s.subject}: ${s.pct}%`).join(', ');
        return {
          ...base,
          module: 'student',
          assistant_text: `Your overall attendance is ${STUDENT_PROFILE.overall_attendance_pct}% (${STUDENT_PROFILE.name}). Subject breakdown: ${b}.`,
          audio_url: TTS.get_attendance
        };
      }
      case 'GET_TIMETABLE': {
        if (sess.role !== 'student') return loginRequired('student', 'student');
        const list = STUDENT_PROFILE.timetable.map((i) => `${i.day}: ${i.schedule}`).join('; ');
        return { ...base, module: 'student', assistant_text: `Here is your timetable schedule: ${list}.`, audio_url: TTS.get_timetable };
      }
      case 'GET_MY_REQUESTS': {
        if (sess.role !== 'student') return loginRequired('student', 'student');
        return { ...base, module: 'student', assistant_text: requestBundleSummary(this.store.student_requests), audio_url: TTS.get_my_requests };
      }
      case 'SUBMIT_LEAVE': {
        if (sess.role !== 'student') return loginRequired('student', 'student');
        sess.flow = 'leave';
        sess.awaiting_slot = 'date';
        return {
          ...base,
          module: 'student',
          assistant_text: 'Which date do you need leave for (e.g. today, tomorrow, or YYYY-MM-DD)?',
          audio_url: TTS.leave_date_prompt
        };
      }
      case 'SUBMIT_ON_DUTY': {
        if (sess.role !== 'student') return loginRequired('student', 'student');
        sess.flow = 'od';
        sess.awaiting_slot = 'date';
        return {
          ...base,
          module: 'student',
          assistant_text: 'Which date do you need On-Duty (OD) for? You can say today or tomorrow.',
          audio_url: TTS.od_date_prompt
        };
      }

      // ----- Teacher -----
      case 'LIST_PENDING': {
        if (sess.role !== 'teacher') return loginRequired('teacher', 'teacher');
        const pending = this.store.pending_requests.filter((r) => r.status === 'PENDING');
        if (pending.length === 0) {
          return { ...base, module: 'teacher', assistant_text: 'There are currently no pending student requests awaiting review.', audio_url: TTS.list_pending };
        }
        const list = pending.map((r) => `[${r.id}] ${r.student_name}: ${r.type} on ${r.date} (${r.reason})`).join('; ');
        return { ...base, module: 'teacher', assistant_text: `Here are the pending requests: ${list}.`, audio_url: TTS.list_pending };
      }
      case 'APPROVE_REQUEST':
      case 'REJECT_REQUEST': {
        if (sess.role !== 'teacher') return loginRequired('teacher', 'teacher');
        const isApprove = intent === 'APPROVE_REQUEST';
        if (!sess.slots.request_id) {
          sess.flow = isApprove ? 'approve' : 'reject';
          sess.awaiting_slot = 'request_id';
          return {
            ...base,
            module: 'teacher',
            assistant_text: `Which request ID would you like to ${isApprove ? 'approve' : 'reject'} (e.g. 35 or REQ-9012)?`,
            audio_url: TTS.request_id_prompt
          };
        }
        const id = sess.slots.request_id;
        delete sess.slots.request_id;
        const action: PendingAction = {
          action_id: makeId('act'),
          tool_name: isApprove ? 'approve_request' : 'reject_request',
          intent,
          slots: { request_id: id, action: isApprove ? 'APPROVE' : 'REJECT' },
          summary: `${isApprove ? 'Approve' : 'Reject'} student request ${id}`
        };
        sess.pending_action = action;
        sess.flow = null;
        return {
          ...base,
          module: 'teacher',
          assistant_text: `You are about to ${isApprove ? 'approve' : 'reject'} request ${id}. Do you confirm this action?`,
          audio_url: isApprove ? TTS.confirm_approve : TTS.confirm_reject,
          pending_action: action,
          needs_confirmation: true
        };
      }

      default:
        return {
          ...base,
          intent: 'UNKNOWN',
          module: 'orchestrator',
          assistant_text:
            "I didn't recognize that command. You can ask for attendance, timetable, exam dates, holidays, courses, or submit leave.",
          audio_url: TTS.unknown
        };
    }
  }
}

export const kitEngine = new KitLocalEngine();
