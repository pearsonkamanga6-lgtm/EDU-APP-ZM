'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'data');
const DATA_FILE = path.join(DATA_DIR, 'data.json');
const PUPIL_SEED_FILE = path.join(DATA_DIR, 'pupils12l.json');
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const TOKEN_SECRET = process.env.TOKEN_SECRET || 'DEV_ONLY_CHANGE_ME_edusend_v1';
const TOKEN_TTL_SECONDS = 60 * 60 * 12;

fs.mkdirSync(DATA_DIR, { recursive: true });

function id(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  try {
    const [salt, hash] = String(stored).split(':');
    if (!salt || !hash) return false;
    const test = crypto.scryptSync(String(password), salt, 64);
    const expected = Buffer.from(hash, 'hex');
    return expected.length === test.length && crypto.timingSafeEqual(expected, test);
  } catch {
    return false;
  }
}

function base64url(input) {
  return Buffer.from(input).toString('base64url');
}

function signToken(payload) {
  const body = base64url(JSON.stringify(payload));
  const sig = crypto.createHmac('sha256', TOKEN_SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function issueToken(userId) {
  const now = Math.floor(Date.now() / 1000);
  return signToken({ userId, iat: now, exp: now + TOKEN_TTL_SECONDS });
}

function readToken(token) {
  if (!token || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  const expected = crypto.createHmac('sha256', TOKEN_SECRET).update(body).digest('base64url');
  try {
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

function safeUser(user) {
  if (!user) return null;
  const { passwordHash, ...rest } = user;
  return rest;
}

function loadPupilsSeed() {
  try {
    const raw = JSON.parse(fs.readFileSync(PUPIL_SEED_FILE, 'utf8'));
    return raw.map((p, idx) => ({
      id: p.id || `12l-${String(idx + 1).padStart(3, '0')}`,
      classId: 'class_12l',
      name: p.name || '',
      sex: p.sex || '',
      examNo: p.examNo || '',
      parentPrimary: p.parentWhatsapp || p.parentPhone || '',
      parentAltPhones: Array.from(new Set([
        ...(p.parentPhone && p.parentPhone !== p.parentWhatsapp ? [p.parentPhone] : []),
        ...(Array.isArray(p.parentAltPhones) ? p.parentAltPhones : [])
      ].filter(Boolean))),
      active: true,
      importedScores: p.scores || {}
    }));
  } catch {
    return [];
  }
}

function makeSeedData() {
  const users = [];
  const addUser = (name, username, password, roles, departmentId = null) => {
    const u = { id: id('usr'), name, username: username.toLowerCase(), passwordHash: hashPassword(password), roles, departmentId, active: true };
    users.push(u);
    return u;
  };

  const deptLanguages = { id: 'dept_languages', name: 'Languages', hodUserId: null };
  const deptScience = { id: 'dept_science', name: 'Mathematics & Science', hodUserId: null };
  const deptSocial = { id: 'dept_social', name: 'Social Sciences', hodUserId: null };
  const deptCommercial = { id: 'dept_commercial', name: 'Commercial Studies', hodUserId: null };
  const departments = [deptLanguages, deptScience, deptSocial, deptCommercial];

  const admin = addUser('School Administrator', 'admin', 'admin123', ['ADMIN']);
  const head = addUser('Head Teacher', 'head', 'head123', ['HEAD']);
  const hodLanguages = addUser('Languages HOD', 'hod.languages', 'hod123', ['HOD', 'TEACHER'], deptLanguages.id);
  const hodScience = addUser('Science HOD', 'hod.science', 'hod123', ['HOD', 'TEACHER'], deptScience.id);
  const hodSocial = addUser('Social Sciences HOD', 'hod.social', 'hod123', ['HOD', 'TEACHER'], deptSocial.id);
  const hodCommercial = addUser('Commercial Studies HOD', 'hod.commercial', 'hod123', ['HOD', 'TEACHER'], deptCommercial.id);
  deptLanguages.hodUserId = hodLanguages.id;
  deptScience.hodUserId = hodScience.id;
  deptSocial.hodUserId = hodSocial.id;
  deptCommercial.hodUserId = hodCommercial.id;

  const kamanga = addUser('Mr Kamanga P', 'kamanga', 'teach123', ['TEACHER'], deptScience.id);
  const englishTeacher = addUser('English Teacher', 'english.teacher', 'teach123', ['TEACHER'], deptLanguages.id);
  const scienceTeacher = addUser('Science Teacher', 'science.teacher', 'teach123', ['TEACHER'], deptScience.id);
  const socialTeacher = addUser('Social Studies Teacher', 'social.teacher', 'teach123', ['TEACHER'], deptSocial.id);
  const commercialTeacher = addUser('Commercial Studies Teacher', 'commercial.teacher', 'teach123', ['TEACHER'], deptCommercial.id);

  const classes = [
    { id: 'class_12l', name: '12L', level: 'Grade 12', gradingSystem: 'LEGACY', classTeacherUserId: kamanga.id, active: true },
    { id: 'class_1m', name: '1M', level: 'Form 1', gradingSystem: 'CBC', classTeacherUserId: null, active: true }
  ];

  const subjects = [
    { id: 'sub_english', name: 'English', departmentId: deptLanguages.id, active: true },
    { id: 'sub_mathematics', name: 'Mathematics', departmentId: deptScience.id, active: true },
    { id: 'sub_biology', name: 'Biology', departmentId: deptScience.id, active: true },
    { id: 'sub_science', name: 'Science', departmentId: deptScience.id, active: true },
    { id: 'sub_geography', name: 'Geography', departmentId: deptSocial.id, active: true },
    { id: 'sub_civic', name: 'Civic Education', departmentId: deptSocial.id, active: true },
    { id: 'sub_commerce', name: 'Commerce', departmentId: deptCommercial.id, active: true },
    { id: 'sub_accounts', name: 'Accounts', departmentId: deptCommercial.id, active: true }
  ];

  const assessment = {
    id: 'assess_mock_2026_t2',
    name: 'Term 2 Mock Examination 2026',
    term: 'Term 2',
    year: 2026,
    dueAt: '2026-09-22T16:00:00+02:00',
    active: true
  };

  const teachingAssignments = [
    { id: 'ta_12l_eng', classId: 'class_12l', subjectId: 'sub_english', teacherUserId: englishTeacher.id, active: true },
    { id: 'ta_12l_mat', classId: 'class_12l', subjectId: 'sub_mathematics', teacherUserId: kamanga.id, active: true },
    { id: 'ta_12l_bio', classId: 'class_12l', subjectId: 'sub_biology', teacherUserId: scienceTeacher.id, active: true },
    { id: 'ta_12l_sci', classId: 'class_12l', subjectId: 'sub_science', teacherUserId: scienceTeacher.id, active: true },
    { id: 'ta_12l_geo', classId: 'class_12l', subjectId: 'sub_geography', teacherUserId: socialTeacher.id, active: true },
    { id: 'ta_12l_civ', classId: 'class_12l', subjectId: 'sub_civic', teacherUserId: socialTeacher.id, active: true },
    { id: 'ta_12l_com', classId: 'class_12l', subjectId: 'sub_commerce', teacherUserId: commercialTeacher.id, active: true },
    { id: 'ta_12l_acc', classId: 'class_12l', subjectId: 'sub_accounts', teacherUserId: commercialTeacher.id, active: true }
  ];

  const pupils = loadPupilsSeed();
  const subjectByName = new Map(subjects.map(s => [s.name, s]));
  const assignmentBySubjectId = new Map(teachingAssignments.map(a => [a.subjectId, a]));
  const resultSheets = [];
  for (const subject of subjects) {
    const assignment = assignmentBySubjectId.get(subject.id);
    if (!assignment) continue;
    const marks = {};
    for (const pupil of pupils) {
      const score = pupil.importedScores?.[subject.name];
      if (score !== undefined && score !== null && score !== '') marks[pupil.id] = Number(score);
    }
    resultSheets.push({
      id: `sheet_${assignment.id}_${assessment.id}`,
      assignmentId: assignment.id,
      assessmentId: assessment.id,
      status: 'SUBMITTED',
      marks,
      updatedAt: '2026-09-17T14:00:00+02:00',
      submittedAt: '2026-09-17T14:00:00+02:00',
      enteredByUserId: assignment.teacherUserId,
      source: 'Imported from existing EduSend 12L mock data'
    });
  }
  pupils.forEach(p => delete p.importedScores);

  return {
    version: 1,
    school: { id: 'school_1', name: 'Lumezi Boarding Secondary School' },
    users,
    departments,
    classes,
    subjects,
    assessments: [assessment],
    teachingAssignments,
    pupils,
    resultSheets,
    auditLog: [{ id: id('audit'), at: new Date().toISOString(), actorUserId: admin.id, action: 'SEED_CREATED', detail: 'Initial EduSend V1 data created' }]
  };
}

function loadData() {
  if (!fs.existsSync(DATA_FILE)) {
    const seed = makeSeedData();
    fs.writeFileSync(DATA_FILE, JSON.stringify(seed, null, 2));
    return seed;
  }
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
}

let db = loadData();

function saveData() {
  const tmp = `${DATA_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DATA_FILE);
}

function audit(actorUserId, action, detail = '') {
  db.auditLog.unshift({ id: id('audit'), at: new Date().toISOString(), actorUserId, action, detail });
  db.auditLog = db.auditLog.slice(0, 1000);
}

function hasRole(user, role) {
  return !!user && Array.isArray(user.roles) && user.roles.includes(role);
}

function isAdminOrHead(user) {
  return hasRole(user, 'ADMIN') || hasRole(user, 'HEAD');
}

function getDepartmentForHod(user) {
  if (!hasRole(user, 'HOD')) return null;
  return db.departments.find(d => d.hodUserId === user.id) || null;
}

function authFromReq(req, urlObj) {
  let token = '';
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) token = header.slice(7);
  if (!token) token = urlObj.searchParams.get('token') || '';
  const payload = readToken(token);
  if (!payload) return { token: null, user: null };
  const user = db.users.find(u => u.id === payload.userId && u.active !== false);
  return { token, user: user || null };
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function sendError(res, status, message) {
  sendJson(res, status, { error: message });
}

function readJson(req, limit = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let total = 0;
    let raw = '';
    req.on('data', chunk => {
      total += chunk.length;
      if (total > limit) {
        reject(new Error('Request too large'));
        req.destroy();
        return;
      }
      raw += chunk;
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch { reject(new Error('Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

function serveStatic(reqPath, res) {
  let relative = reqPath === '/' ? '/index.html' : reqPath;
  try { relative = decodeURIComponent(relative); } catch {}
  const safe = path.normalize(relative).replace(/^([.][.][/\\])+/, '');
  const filePath = path.join(PUBLIC_DIR, safe);
  if (!filePath.startsWith(PUBLIC_DIR)) return sendError(res, 403, 'Forbidden');
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return false;
  const ext = path.extname(filePath).toLowerCase();
  const type = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg'
  }[ext] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': type, 'Cache-Control': ext === '.html' ? 'no-store' : 'public, max-age=300' });
  fs.createReadStream(filePath).pipe(res);
  return true;
}

function findSheet(assignmentId, assessmentId) {
  return db.resultSheets.find(s => s.assignmentId === assignmentId && s.assessmentId === assessmentId) || null;
}

function ensureSheet(assignment, assessmentId, actorUserId) {
  let sheet = findSheet(assignment.id, assessmentId);
  if (!sheet) {
    sheet = {
      id: id('sheet'), assignmentId: assignment.id, assessmentId, status: 'NOT_STARTED', marks: {},
      updatedAt: null, submittedAt: null, enteredByUserId: actorUserId, source: 'Teacher entry'
    };
    db.resultSheets.push(sheet);
  }
  return sheet;
}

function getDeadlineState(assessment, status) {
  const due = new Date(assessment.dueAt).getTime();
  const now = Date.now();
  const ms = due - now;
  const submitted = status === 'SUBMITTED' || status === 'LOCKED';
  if (submitted) return { code: 'DONE', text: status === 'LOCKED' ? 'Locked' : 'Submitted', msRemaining: ms };
  if (ms < 0) return { code: 'OVERDUE', text: 'Overdue', msRemaining: ms };
  const days = ms / 86400000;
  if (days <= 1) return { code: 'DUE_SOON', text: 'Due within 24 hours', msRemaining: ms };
  if (days <= 3) return { code: 'DUE_SOON', text: `Due in ${Math.ceil(days)} days`, msRemaining: ms };
  if (days <= 7) return { code: 'UPCOMING', text: `Due in ${Math.ceil(days)} days`, msRemaining: ms };
  return { code: 'OPEN', text: 'Open', msRemaining: ms };
}

function assignmentView(a) {
  const cls = db.classes.find(c => c.id === a.classId);
  const subject = db.subjects.find(s => s.id === a.subjectId);
  const teacher = db.users.find(u => u.id === a.teacherUserId);
  return {
    ...a,
    className: cls?.name || '',
    subjectName: subject?.name || '',
    teacherName: teacher?.name || ''
  };
}

function canViewClass(user, classId) {
  if (isAdminOrHead(user)) return true;
  return db.classes.some(c => c.id === classId && c.classTeacherUserId === user.id);
}

function normalizeMark(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 100) return undefined;
  return Math.round(n * 10) / 10;
}

const sseClients = new Set();
function broadcastEvent(event) {
  const payload = `event: update\ndata: ${JSON.stringify(event)}\n\n`;
  for (const client of [...sseClients]) {
    try { client.res.write(payload); } catch { sseClients.delete(client); }
  }
}

async function api(req, res, urlObj) {
  const pathname = urlObj.pathname;

  if (req.method === 'POST' && pathname === '/api/login') {
    const body = await readJson(req);
    const username = String(body.username || '').trim().toLowerCase();
    const password = String(body.password || '');
    const user = db.users.find(u => u.username === username && u.active !== false);
    if (!user || !verifyPassword(password, user.passwordHash)) return sendError(res, 401, 'Invalid username or password');
    audit(user.id, 'LOGIN', username);
    saveData();
    return sendJson(res, 200, { token: issueToken(user.id), user: safeUser(user), school: db.school });
  }

  const { token, user } = authFromReq(req, urlObj);
  if (!user) return sendError(res, 401, 'Authentication required');

  if (req.method === 'GET' && pathname === '/api/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    res.write(`event: hello\ndata: ${JSON.stringify({ ok: true, userId: user.id })}\n\n`);
    const client = { res, userId: user.id };
    sseClients.add(client);
    const heartbeat = setInterval(() => {
      try { res.write(`: ping ${Date.now()}\n\n`); } catch {}
    }, 25000);
    req.on('close', () => { clearInterval(heartbeat); sseClients.delete(client); });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/me') {
    const classTeacherClasses = db.classes.filter(c => c.classTeacherUserId === user.id).map(c => ({ id: c.id, name: c.name, level: c.level, gradingSystem: c.gradingSystem }));
    const hodDepartment = getDepartmentForHod(user);
    return sendJson(res, 200, { user: safeUser(user), school: db.school, classTeacherClasses, hodDepartment });
  }

  if (req.method === 'GET' && pathname === '/api/assessments') {
    return sendJson(res, 200, { assessments: db.assessments.filter(a => a.active !== false) });
  }

  if (req.method === 'GET' && pathname === '/api/reminders') {
    const own = db.teachingAssignments.filter(a => a.active !== false && a.teacherUserId === user.id);
    const reminders = [];
    for (const assignment of own) {
      for (const assessment of db.assessments.filter(a => a.active !== false)) {
        const sheet = findSheet(assignment.id, assessment.id);
        const status = sheet?.status || 'NOT_STARTED';
        if (status === 'SUBMITTED' || status === 'LOCKED') continue;
        reminders.push({
          assignment: assignmentView(assignment), assessment,
          status, deadline: getDeadlineState(assessment, status)
        });
      }
    }
    reminders.sort((a, b) => new Date(a.assessment.dueAt) - new Date(b.assessment.dueAt));
    return sendJson(res, 200, { reminders });
  }

  if (req.method === 'GET' && pathname === '/api/teacher/assignments') {
    const assignments = db.teachingAssignments
      .filter(a => a.active !== false && a.teacherUserId === user.id)
      .map(a => {
        const view = assignmentView(a);
        const sheets = db.assessments.filter(x => x.active !== false).map(assessment => {
          const sheet = findSheet(a.id, assessment.id);
          const status = sheet?.status || 'NOT_STARTED';
          return { assessment, status, updatedAt: sheet?.updatedAt || null, submittedAt: sheet?.submittedAt || null, deadline: getDeadlineState(assessment, status) };
        });
        return { ...view, sheets };
      });
    return sendJson(res, 200, { assignments });
  }

  if (req.method === 'GET' && pathname === '/api/teacher/sheet') {
    const assignmentId = urlObj.searchParams.get('assignmentId');
    const assessmentId = urlObj.searchParams.get('assessmentId');
    const assignment = db.teachingAssignments.find(a => a.id === assignmentId && a.active !== false);
    if (!assignment || assignment.teacherUserId !== user.id) return sendError(res, 403, 'You can only open subjects assigned to you');
    const assessment = db.assessments.find(a => a.id === assessmentId && a.active !== false);
    if (!assessment) return sendError(res, 404, 'Assessment not found');
    const pupils = db.pupils.filter(p => p.classId === assignment.classId && p.active !== false).map(p => ({ id: p.id, name: p.name, sex: p.sex, examNo: p.examNo || '' }));
    const sheet = ensureSheet(assignment, assessmentId, user.id);
    return sendJson(res, 200, {
      assignment: assignmentView(assignment), assessment,
      sheet: { id: sheet.id, status: sheet.status, marks: sheet.marks || {}, updatedAt: sheet.updatedAt, submittedAt: sheet.submittedAt },
      pupils
    });
  }

  if (req.method === 'PUT' && pathname === '/api/teacher/sheet') {
    const body = await readJson(req);
    const assignment = db.teachingAssignments.find(a => a.id === body.assignmentId && a.active !== false);
    if (!assignment || assignment.teacherUserId !== user.id) return sendError(res, 403, 'You may only edit your assigned subject');
    const assessment = db.assessments.find(a => a.id === body.assessmentId && a.active !== false);
    if (!assessment) return sendError(res, 404, 'Assessment not found');
    const sheet = ensureSheet(assignment, assessment.id, user.id);
    if (sheet.status === 'LOCKED') return sendError(res, 409, 'This result sheet has been locked by administration');
    const classPupilIds = new Set(db.pupils.filter(p => p.classId === assignment.classId && p.active !== false).map(p => p.id));
    const marks = {};
    for (const row of Array.isArray(body.marks) ? body.marks : []) {
      if (!classPupilIds.has(row.pupilId)) continue;
      const mark = normalizeMark(row.mark);
      if (mark === undefined) return sendError(res, 400, `Invalid mark for pupil ${row.pupilId}. Marks must be 0–100 or blank.`);
      if (mark !== null) marks[row.pupilId] = mark;
    }
    sheet.marks = marks;
    sheet.updatedAt = new Date().toISOString();
    sheet.enteredByUserId = user.id;
    const action = body.action === 'submit' ? 'submit' : 'draft';
    if (action === 'submit') {
      sheet.status = 'SUBMITTED';
      sheet.submittedAt = new Date().toISOString();
      audit(user.id, 'RESULTS_SUBMITTED', `${assignment.classId}/${assignment.subjectId}/${assessment.id}`);
    } else {
      sheet.status = Object.keys(marks).length ? 'DRAFT' : 'NOT_STARTED';
      audit(user.id, 'RESULTS_DRAFT_SAVED', `${assignment.classId}/${assignment.subjectId}/${assessment.id}`);
    }
    saveData();
    broadcastEvent({ type: 'RESULT_SHEET_UPDATED', classId: assignment.classId, subjectId: assignment.subjectId, assessmentId: assessment.id, status: sheet.status, at: sheet.updatedAt });
    return sendJson(res, 200, { ok: true, status: sheet.status, updatedAt: sheet.updatedAt, submittedAt: sheet.submittedAt });
  }

  if (req.method === 'GET' && pathname === '/api/class-teacher/classes') {
    const classes = db.classes.filter(c => c.active !== false && (isAdminOrHead(user) || c.classTeacherUserId === user.id));
    return sendJson(res, 200, { classes });
  }

  if (req.method === 'GET' && pathname === '/api/class-teacher/overview') {
    const classId = urlObj.searchParams.get('classId');
    const assessmentId = urlObj.searchParams.get('assessmentId');
    if (!canViewClass(user, classId)) return sendError(res, 403, 'You are not the class teacher for this class');
    const cls = db.classes.find(c => c.id === classId);
    const assessment = db.assessments.find(a => a.id === assessmentId);
    if (!cls || !assessment) return sendError(res, 404, 'Class or assessment not found');
    const assignments = db.teachingAssignments.filter(a => a.classId === classId && a.active !== false).map(assignmentView);
    const subjects = assignments.map(a => {
      const sheet = findSheet(a.id, assessmentId);
      return {
        assignmentId: a.id,
        subjectId: a.subjectId,
        subjectName: a.subjectName,
        teacherName: a.teacherName,
        status: sheet?.status || 'NOT_STARTED',
        updatedAt: sheet?.updatedAt || null,
        submittedAt: sheet?.submittedAt || null,
        deadline: getDeadlineState(assessment, sheet?.status || 'NOT_STARTED')
      };
    });
    const pupils = db.pupils.filter(p => p.classId === classId && p.active !== false).map(p => {
      const marks = {};
      for (const a of assignments) {
        const sheet = findSheet(a.id, assessmentId);
        if (sheet && (sheet.status === 'SUBMITTED' || sheet.status === 'LOCKED')) {
          marks[a.subjectId] = sheet.marks?.[p.id] ?? null;
        }
      }
      return {
        id: p.id, name: p.name, sex: p.sex, examNo: p.examNo || '',
        parentPrimary: p.parentPrimary || '', parentAltPhones: p.parentAltPhones || [], marks
      };
    });
    return sendJson(res, 200, { class: cls, assessment, subjects, pupils });
  }

  if (req.method === 'GET' && pathname === '/api/hod/assignments') {
    const dept = getDepartmentForHod(user);
    if (!dept) return sendError(res, 403, 'HOD access required');
    const subjects = db.subjects.filter(s => s.departmentId === dept.id && s.active !== false);
    const teachers = db.users.filter(u => u.active !== false && u.departmentId === dept.id && hasRole(u, 'TEACHER')).map(safeUser);
    const assignments = db.teachingAssignments.filter(a => {
      const s = db.subjects.find(x => x.id === a.subjectId);
      return s?.departmentId === dept.id && a.active !== false;
    }).map(assignmentView);
    return sendJson(res, 200, { department: dept, subjects, teachers, classes: db.classes.filter(c => c.active !== false), assignments });
  }

  if (req.method === 'POST' && pathname === '/api/hod/assign') {
    const dept = getDepartmentForHod(user);
    if (!dept) return sendError(res, 403, 'HOD access required');
    const body = await readJson(req);
    const subject = db.subjects.find(s => s.id === body.subjectId && s.active !== false);
    const cls = db.classes.find(c => c.id === body.classId && c.active !== false);
    const teacher = db.users.find(u => u.id === body.teacherUserId && u.active !== false);
    if (!subject || subject.departmentId !== dept.id) return sendError(res, 403, 'You can only assign subjects in your department');
    if (!cls) return sendError(res, 404, 'Class not found');
    if (!teacher || teacher.departmentId !== dept.id || !hasRole(teacher, 'TEACHER')) return sendError(res, 400, 'Teacher must belong to your department');
    let assignment = db.teachingAssignments.find(a => a.classId === cls.id && a.subjectId === subject.id && a.active !== false);
    if (assignment) assignment.teacherUserId = teacher.id;
    else {
      assignment = { id: id('ta'), classId: cls.id, subjectId: subject.id, teacherUserId: teacher.id, active: true };
      db.teachingAssignments.push(assignment);
    }
    audit(user.id, 'TEACHING_ASSIGNMENT_SET', `${cls.name} / ${subject.name} -> ${teacher.name}`);
    saveData();
    broadcastEvent({ type: 'ASSIGNMENT_UPDATED', classId: cls.id, subjectId: subject.id, teacherUserId: teacher.id });
    return sendJson(res, 200, { assignment: assignmentView(assignment) });
  }

  if (req.method === 'GET' && pathname === '/api/hod/progress') {
    const dept = getDepartmentForHod(user);
    if (!dept) return sendError(res, 403, 'HOD access required');
    const assessmentId = urlObj.searchParams.get('assessmentId') || db.assessments.find(a => a.active !== false)?.id;
    const assessment = db.assessments.find(a => a.id === assessmentId);
    if (!assessment) return sendError(res, 404, 'Assessment not found');
    const rows = db.teachingAssignments.filter(a => {
      const subject = db.subjects.find(s => s.id === a.subjectId);
      return a.active !== false && subject?.departmentId === dept.id;
    }).map(a => {
      const sheet = findSheet(a.id, assessment.id);
      const status = sheet?.status || 'NOT_STARTED';
      return { ...assignmentView(a), status, updatedAt: sheet?.updatedAt || null, submittedAt: sheet?.submittedAt || null, deadline: getDeadlineState(assessment, status) };
    });
    return sendJson(res, 200, { department: dept, assessment, rows });
  }

  if (req.method === 'GET' && pathname === '/api/school/progress') {
    if (!isAdminOrHead(user)) return sendError(res, 403, 'Administrator or Head Teacher access required');
    const assessmentId = urlObj.searchParams.get('assessmentId') || db.assessments.find(a => a.active !== false)?.id;
    const assessment = db.assessments.find(a => a.id === assessmentId);
    if (!assessment) return sendError(res, 404, 'Assessment not found');
    const rows = db.teachingAssignments.filter(a => a.active !== false).map(a => {
      const sheet = findSheet(a.id, assessment.id);
      const status = sheet?.status || 'NOT_STARTED';
      const subject = db.subjects.find(s => s.id === a.subjectId);
      const dept = db.departments.find(d => d.id === subject?.departmentId);
      return { ...assignmentView(a), departmentName: dept?.name || '', status, updatedAt: sheet?.updatedAt || null, submittedAt: sheet?.submittedAt || null, deadline: getDeadlineState(assessment, status) };
    });
    return sendJson(res, 200, { assessment, rows });
  }

  if (req.method === 'GET' && pathname === '/api/admin/setup') {
    if (!hasRole(user, 'ADMIN')) return sendError(res, 403, 'Administrator access required');
    return sendJson(res, 200, {
      school: db.school,
      users: db.users.map(safeUser), departments: db.departments,
      classes: db.classes, subjects: db.subjects, assessments: db.assessments,
      teachingAssignments: db.teachingAssignments.map(assignmentView)
    });
  }

  if (req.method === 'POST' && pathname === '/api/admin/user') {
    if (!hasRole(user, 'ADMIN')) return sendError(res, 403, 'Administrator access required');
    const body = await readJson(req);
    const name = String(body.name || '').trim();
    const username = String(body.username || '').trim().toLowerCase();
    const password = String(body.password || '');
    const roles = Array.isArray(body.roles) ? body.roles.filter(r => ['ADMIN', 'HEAD', 'HOD', 'TEACHER'].includes(r)) : ['TEACHER'];
    if (!name || !username || password.length < 6) return sendError(res, 400, 'Name, username and password of at least 6 characters are required');
    if (db.users.some(u => u.username === username)) return sendError(res, 409, 'Username already exists');
    const newUser = { id: id('usr'), name, username, passwordHash: hashPassword(password), roles: roles.length ? roles : ['TEACHER'], departmentId: body.departmentId || null, active: true };
    db.users.push(newUser);
    audit(user.id, 'USER_CREATED', `${name} (${username})`);
    saveData();
    return sendJson(res, 201, { user: safeUser(newUser) });
  }

  if (req.method === 'POST' && pathname === '/api/admin/class-teacher') {
    if (!hasRole(user, 'ADMIN')) return sendError(res, 403, 'Administrator access required');
    const body = await readJson(req);
    const cls = db.classes.find(c => c.id === body.classId);
    const teacher = db.users.find(u => u.id === body.teacherUserId && u.active !== false);
    if (!cls || !teacher || !hasRole(teacher, 'TEACHER')) return sendError(res, 400, 'Valid class and teacher required');
    cls.classTeacherUserId = teacher.id;
    audit(user.id, 'CLASS_TEACHER_SET', `${cls.name} -> ${teacher.name}`);
    saveData();
    broadcastEvent({ type: 'CLASS_TEACHER_UPDATED', classId: cls.id, teacherUserId: teacher.id });
    return sendJson(res, 200, { class: cls });
  }

  if (req.method === 'POST' && pathname === '/api/admin/class') {
    if (!hasRole(user, 'ADMIN')) return sendError(res, 403, 'Administrator access required');
    const body = await readJson(req);
    const name = String(body.name || '').trim();
    if (!name) return sendError(res, 400, 'Class name is required');
    if (db.classes.some(c => c.name.toLowerCase() === name.toLowerCase() && c.active !== false)) return sendError(res, 409, 'Class already exists');
    const cls = { id: id('class'), name, level: String(body.level || '').trim(), gradingSystem: body.gradingSystem === 'CBC' ? 'CBC' : 'LEGACY', classTeacherUserId: null, active: true };
    db.classes.push(cls);
    audit(user.id, 'CLASS_CREATED', name);
    saveData();
    return sendJson(res, 201, { class: cls });
  }

  if (req.method === 'POST' && pathname === '/api/admin/assessment') {
    if (!hasRole(user, 'ADMIN')) return sendError(res, 403, 'Administrator access required');
    const body = await readJson(req);
    const name = String(body.name || '').trim();
    const dueAt = String(body.dueAt || '').trim();
    if (!name || !dueAt || Number.isNaN(new Date(dueAt).getTime())) return sendError(res, 400, 'Valid assessment name and deadline are required');
    const assessment = { id: id('assess'), name, term: String(body.term || '').trim(), year: Number(body.year || new Date().getFullYear()), dueAt, active: true };
    db.assessments.push(assessment);
    audit(user.id, 'ASSESSMENT_CREATED', `${name} due ${dueAt}`);
    saveData();
    broadcastEvent({ type: 'ASSESSMENT_CREATED', assessmentId: assessment.id });
    return sendJson(res, 201, { assessment });
  }

  if (req.method === 'POST' && pathname === '/api/admin/pupil') {
    if (!hasRole(user, 'ADMIN')) return sendError(res, 403, 'Administrator access required');
    const body = await readJson(req);
    const cls = db.classes.find(c => c.id === body.classId && c.active !== false);
    const name = String(body.name || '').trim();
    if (!cls || !name) return sendError(res, 400, 'Class and pupil name are required');
    const pupil = {
      id: id('pupil'), classId: cls.id, name,
      sex: String(body.sex || '').trim().toUpperCase().slice(0, 1), examNo: String(body.examNo || '').trim(),
      parentPrimary: String(body.parentPrimary || '').trim(), parentAltPhones: Array.isArray(body.parentAltPhones) ? body.parentAltPhones.map(String) : [], active: true
    };
    db.pupils.push(pupil);
    audit(user.id, 'PUPIL_CREATED', `${name} / ${cls.name}`);
    saveData();
    return sendJson(res, 201, { pupil });
  }

  if (req.method === 'POST' && pathname === '/api/admin/lock-sheet') {
    if (!hasRole(user, 'ADMIN')) return sendError(res, 403, 'Administrator access required');
    const body = await readJson(req);
    const sheet = findSheet(body.assignmentId, body.assessmentId);
    if (!sheet) return sendError(res, 404, 'Result sheet not found');
    sheet.status = body.lock === false ? 'SUBMITTED' : 'LOCKED';
    sheet.updatedAt = new Date().toISOString();
    audit(user.id, sheet.status === 'LOCKED' ? 'RESULT_SHEET_LOCKED' : 'RESULT_SHEET_UNLOCKED', `${body.assignmentId}/${body.assessmentId}`);
    saveData();
    broadcastEvent({ type: 'RESULT_SHEET_UPDATED', assignmentId: body.assignmentId, assessmentId: body.assessmentId, status: sheet.status });
    return sendJson(res, 200, { status: sheet.status });
  }

  return sendError(res, 404, 'API endpoint not found');
}

const server = http.createServer(async (req, res) => {
  const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (urlObj.pathname.startsWith('/api/')) {
      await api(req, res, urlObj);
      return;
    }
    if (serveStatic(urlObj.pathname, res) === false) sendError(res, 404, 'Not found');
  } catch (err) {
    console.error(err);
    if (!res.headersSent) sendError(res, 500, err.message || 'Server error');
    else res.end();
  }
});

server.listen(PORT, HOST, () => {
  console.log(`EduSend V1 running on http://${HOST}:${PORT}`);
  if (TOKEN_SECRET.includes('DEV_ONLY')) console.warn('WARNING: Set TOKEN_SECRET before public deployment.');
});
