// College data for the in-browser KIT VOX engine (React-only, no backend).
// Ported verbatim from the original mock database so the assistant answers
// with the same facts the Python backend served.

export interface Course {
  code: string;
  title: string;
  duration: string;
  annual_fee: string;
  seats: number;
  eligibility: string;
}

export interface Holiday {
  date: string;
  name: string;
}

export interface Exam {
  date: string;
  subject: string;
  time: string;
}

export interface PlacementDrive {
  id: number;
  company: string;
  category: 'dream' | 'non_dream';
  min_cgpa: number;
  allowed_departments: string[];
  eligible_years: number[];
  deadline: string;
  seats_total: number;
  seats_left: number;
}

export interface StudentRequest {
  id: string;
  type: 'LEAVE' | 'ON_DUTY';
  date: string;
  reason: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  reviewed_by?: string;
}

export interface PendingRequest {
  id: string;
  student_id: string;
  student_name: string;
  type: string;
  date: string;
  reason: string;
  status: string;
  reviewed_by?: string;
}

export const COLLEGE_INFO = {
  name: 'Knotopian Institute of Technology (KIT)',
  motto: 'Excellence in Engineering and Applied Technology',
  location: 'Knotopian Knowledge City, Coimbatore, Tamil Nadu 641042',
  accreditation: 'Autonomous Premier Institution',
  helpline: '+91 422 2619000',
  email: 'admissions@kit.ac.in'
};

export const COURSES: Course[] = [
  {
    code: 'BTECH-CSE',
    title: 'B.Tech in Computer Science and Engineering',
    duration: '4 Years',
    annual_fee: 'Rs. 1,80,000',
    seats: 180,
    eligibility: '10+2 with 60% aggregate in Physics, Chemistry & Math. Valid State CET/JEE score.'
  },
  {
    code: 'BTECH-AIDS',
    title: 'B.Tech in Artificial Intelligence & Data Science',
    duration: '4 Years',
    annual_fee: 'Rs. 1,90,000',
    seats: 120,
    eligibility: '10+2 with 60% aggregate in PCM.'
  },
  {
    code: 'BTECH-ECE',
    title: 'B.Tech in Electronics & Communication Engineering',
    duration: '4 Years',
    annual_fee: 'Rs. 1,60,000',
    seats: 120,
    eligibility: '10+2 with 55% aggregate in PCM.'
  }
];

export const HOLIDAYS: Holiday[] = [
  { date: '2026-12-25', name: 'Christmas Day' },
  { date: '2027-01-01', name: "New Year's Day" },
  { date: '2027-01-14', name: 'Pongal Festival' }
];

export const EXAMS: Exam[] = [
  { date: '2026-11-20', subject: 'CS304 Database Systems Midterm', time: '10:00 AM' },
  { date: '2026-11-23', subject: 'CS302 Computer Networks Midterm', time: '10:00 AM' },
  { date: '2026-11-25', subject: 'CS301 Algorithms Midterm', time: '02:00 PM' }
];

export const PLACEMENT_DRIVES: PlacementDrive[] = [
  {
    id: 21,
    company: 'Freshworks',
    category: 'dream',
    min_cgpa: 8.0,
    allowed_departments: ['CSE'],
    eligible_years: [4],
    deadline: '2026-11-28',
    seats_total: 20,
    seats_left: 12
  },
  {
    id: 20,
    company: 'TCS',
    category: 'non_dream',
    min_cgpa: 6.0,
    allowed_departments: ['CSE', 'ECE', 'MECH'],
    eligible_years: [4],
    deadline: '2026-12-01',
    seats_total: 50,
    seats_left: 31
  }
];

export const MIN_ATTENDANCE_PCT = 75;

export interface StudentProfile {
  account_id: string;
  login_id: string;
  student_id: string;
  name: string;
  department: string;
  year: number;
  overall_attendance_pct: number;
  attendance_breakdown: { subject: string; code: string; attended: number; total: number; pct: number }[];
  timetable: { day: string; schedule: string }[];
  requests: StudentRequest[];
}

export const STUDENT_PROFILE: StudentProfile = {
  account_id: '76',
  login_id: 'arjun',
  student_id: 'KIT2024CS042',
  name: 'Arjun K',
  department: 'Computer Science & Engineering',
  year: 2,
  overall_attendance_pct: 76.0,
  attendance_breakdown: [
    { subject: 'Data Structures and Algorithms', code: 'CS301', attended: 18, total: 20, pct: 90.0 },
    { subject: 'Computer Networks', code: 'CS302', attended: 10, total: 15, pct: 66.7 },
    { subject: 'Operating Systems', code: 'CS303', attended: 10, total: 15, pct: 66.7 }
  ],
  timetable: [
    { day: 'Monday', schedule: '09:00 CS301 (Hall A), 11:00 CS302 (Lab 2), 14:00 CS303' },
    { day: 'Tuesday', schedule: '10:00 CS304, 11:30 CS301, 14:30 AI Elective' },
    { day: 'Wednesday', schedule: '09:00 CS302, 11:00 OS Lab, 15:00 Library' },
    { day: 'Thursday', schedule: '10:00 CS303, 11:30 CS304, 14:00 Seminar' },
    { day: 'Friday', schedule: '09:00 CS301, 10:30 Sports / Club, 14:00 Mentoring' }
  ],
  requests: [
    {
      id: '32',
      type: 'ON_DUTY',
      date: '2026-11-30',
      reason: 'Technical Symposium',
      status: 'APPROVED',
      reviewed_by: 'Dr. Lakshmi'
    }
  ]
};

export const TEACHER_PROFILE = {
  account_id: '73',
  login_id: 'lakshmi',
  teacher_id: 'FAC882',
  name: 'Dr. Lakshmi',
  department: 'Computer Science & Engineering',
  classes: ['CS301 - Algorithms', 'CS302 - Networks']
};

// Accounts accepted by the demo login (same credentials the original backend accepted).
export const DEMO_ACCOUNTS = {
  student: {
    login_ids: ['arjun', 'priya', 'kavya', 'rahul'],
    password: 'Kit@2026',
    display_name: 'Arjun K'
  },
  teacher: {
    login_ids: ['lakshmi', 'senthil'],
    password: 'Kit@2026',
    display_name: 'Dr. Lakshmi'
  }
};

// Pending teacher-review queue (mutable copy — approve/reject mutate this).
export const INITIAL_PENDING_REQUESTS: PendingRequest[] = [
  {
    id: '35',
    student_id: '77',
    student_name: 'Priya M',
    type: 'LEAVE',
    date: '2026-11-25',
    reason: 'Family function in hometown',
    status: 'PENDING'
  },
  {
    id: 'REQ-9012',
    student_id: '76',
    student_name: 'Arjun K',
    type: 'ON_DUTY',
    date: '2026-11-18',
    reason: 'National Hackathon 2026',
    status: 'PENDING'
  }
];

// Pre-recorded voice prompts served as static assets from /tts (no backend needed).
export const TTS = {
  welcome: '/tts/welcome.wav',
  get_attendance: '/tts/get_attendance.wav',
  get_timetable: '/tts/get_timetable.wav',
  get_my_requests: '/tts/get_my_requests.wav',
  list_pending: '/tts/list_pending.wav',
  leave_date_prompt: '/tts/leave_date_prompt.wav',
  leave_reason_prompt: '/tts/leave_reason_prompt.wav',
  od_date_prompt: '/tts/od_date_prompt.wav',
  od_event_prompt: '/tts/od_event_prompt.wav',
  request_id_prompt: '/tts/request_id_prompt.wav',
  confirm_leave: '/tts/confirm_leave.wav',
  confirm_od: '/tts/confirm_od.wav',
  confirm_approve: '/tts/confirm_approve.wav',
  confirm_reject: '/tts/confirm_reject.wav',
  action_confirmed: '/tts/action_confirmed.wav',
  action_cancelled: '/tts/action_cancelled.wav',
  college_info: '/tts/college_info.wav',
  get_courses: '/tts/get_courses.wav',
  get_eligibility: '/tts/get_eligibility.wav',
  get_holidays: '/tts/get_holidays.wav',
  get_exam_dates: '/tts/get_exam_dates.wav',
  login_required: '/tts/login_required.wav',
  repeat_prompt: '/tts/repeat_prompt.wav',
  unknown: '/tts/unknown.wav',
  error: '/tts/error.wav'
};
