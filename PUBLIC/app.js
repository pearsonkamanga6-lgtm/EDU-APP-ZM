(() => {
  const app = document.getElementById('app');
  const state = {
    token: localStorage.getItem('edusend_token') || '',
    me: null,
    assessments: [],
    page: 'dashboard',
    eventSource: null,
    refreshTimer: null
  };

  const esc = (s) => String(s ?? '').replace(/[&<>'"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]));
  const fmtDate = (s) => s ? new Date(s).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '—';
  const byId = (id) => document.getElementById(id);

  function statusPill(status, deadline) {
    const st = status || 'NOT_STARTED';
    if (st === 'LOCKED') return '<span class="pill pill-violet">Locked</span>';
    if (st === 'SUBMITTED') return '<span class="pill pill-green">Submitted</span>';
    if (st === 'DRAFT') return '<span class="pill pill-blue">Draft</span>';
    if (deadline?.code === 'OVERDUE') return '<span class="pill pill-red">Overdue</span>';
    if (deadline?.code === 'DUE_SOON') return '<span class="pill pill-orange">Due soon</span>';
    return '<span class="pill pill-grey">Not started</span>';
  }

  function deadlineBanner(reminders) {
    if (!reminders?.length) return '<div class="alert alert-green"><b>✓ All assigned result sheets are submitted.</b> No outstanding result entry reminders.</div>';
    const overdue = reminders.filter(r => r.deadline.code === 'OVERDUE');
    const soon = reminders.filter(r => r.deadline.code === 'DUE_SOON');
    if (overdue.length) return `<div class="alert alert-red"><b>${overdue.length} result sheet${overdue.length === 1 ? '' : 's'} overdue.</b> Please enter and submit the outstanding results immediately.</div>`;
    if (soon.length) return `<div class="alert alert-orange"><b>${soon.length} result sheet${soon.length === 1 ? '' : 's'} due soon.</b> Complete them before the deadline.</div>`;
    return `<div class="alert alert-blue"><b>${reminders.length} result sheet${reminders.length === 1 ? '' : 's'} still open.</b> The app will keep reminding you as the deadline approaches.</div>`;
  }

  async function api(path, opts = {}) {
    const headers = { ...(opts.headers || {}) };
    if (state.token) headers.Authorization = `Bearer ${state.token}`;
    if (opts.body && !(opts.body instanceof FormData)) headers['Content-Type'] = 'application/json';
    const res = await fetch(path, { ...opts, headers, body: opts.body && !(opts.body instanceof FormData) && typeof opts.body !== 'string' ? JSON.stringify(opts.body) : opts.body });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) {
      logout(false);
      throw new Error(data.error || 'Session expired');
    }
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }

  function toast(message, bad = false) {
    let el = document.querySelector('.toast');
    if (!el) {
      el = document.createElement('div');
      el.className = 'toast';
      Object.assign(el.style, {position:'fixed',right:'16px',bottom:'16px',zIndex:'100',padding:'12px 14px',borderRadius:'10px',color:'#fff',fontWeight:'700',fontSize:'13px',boxShadow:'0 12px 40px #0004'});
      document.body.appendChild(el);
    }
    el.style.background = bad ? '#a61b1b' : '#0b6f51';
    el.textContent = message;
    el.style.display = 'block';
    clearTimeout(el._t);
    el._t = setTimeout(() => el.style.display = 'none', 3500);
  }

  function renderLogin() {
    disconnectEvents();
    app.innerHTML = `
      <div class="login-page">
        <div class="login-card">
          <div class="brand">
            <div class="brand-mark">ES</div>
            <div><h1>EduSend School Results</h1><p>Role-based results management — V1</p></div>
          </div>
          <div class="alert alert-blue small"><b>V1 foundation:</b> Administrator → HOD → Subject Teacher → Class Teacher workflow, with result-entry deadlines and live class updates.</div>
          <form id="loginForm">
            <div class="field"><label>Username</label><input id="username" autocomplete="username" value="kamanga" required /></div>
            <div class="field"><label>Password</label><input id="password" type="password" autocomplete="current-password" value="teach123" required /></div>
            <button class="btn btn-primary full" type="submit">Sign in</button>
          </form>
          <div class="demo-box">
            <b class="small">Starter accounts</b>
            <div class="demo-grid" style="margin-top:8px">
              <div><b>Administrator</b><br><span class="mono">admin / admin123</span></div>
              <div><b>Head Teacher</b><br><span class="mono">head / head123</span></div>
              <div><b>Science HOD</b><br><span class="mono">hod.science / hod123</span></div>
              <div><b>Mr Kamanga P</b><br><span class="mono">kamanga / teach123</span></div>
              <div><b>English Teacher</b><br><span class="mono">english.teacher / teach123</span></div>
              <div><b>Other departments</b><br><span class="mono">hod.social / hod123</span></div>
            </div>
            <p class="tiny muted" style="margin-bottom:0">These are starter/demo credentials. Before public deployment, change passwords and set a strong TOKEN_SECRET.</p>
          </div>
        </div>
      </div>`;
    byId('loginForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = e.submitter;
      btn.disabled = true; btn.textContent = 'Signing in...';
      try {
        const data = await api('/api/login', { method: 'POST', body: { username: byId('username').value, password: byId('password').value } });
        state.token = data.token;
        localStorage.setItem('edusend_token', state.token);
        await bootstrap();
      } catch (err) {
        toast(err.message, true);
      } finally {
        btn.disabled = false; btn.textContent = 'Sign in';
      }
    });
  }

  function logout(show = true) {
    state.token = '';
    state.me = null;
    localStorage.removeItem('edusend_token');
    disconnectEvents();
    renderLogin();
    if (show) toast('Signed out');
  }

  async function bootstrap() {
    try {
      const [me, assessments] = await Promise.all([api('/api/me'), api('/api/assessments')]);
      state.me = me;
      state.assessments = assessments.assessments || [];
      renderShell();
      connectEvents();
      await navigate('dashboard');
    } catch (err) {
      state.token = '';
      localStorage.removeItem('edusend_token');
      renderLogin();
      toast(err.message, true);
    }
  }

  function roleNames() {
    const roles = state.me?.user?.roles || [];
    const out = [...roles];
    if (state.me?.classTeacherClasses?.length) out.push('CLASS TEACHER');
    return out;
  }

  function navItems() {
    const roles = state.me.user.roles || [];
    const items = [{ id:'dashboard', label:'Dashboard' }];
    if (roles.includes('TEACHER')) items.push({ id:'teacher', label:'My Result Sheets' });
    if (state.me.classTeacherClasses?.length || roles.includes('ADMIN') || roles.includes('HEAD')) items.push({ id:'classTeacher', label:'Class Results' });
    if (roles.includes('HOD')) {
      items.push({ id:'hodAssignments', label:'Department Assignments' });
      items.push({ id:'hodProgress', label:'Department Progress' });
    }
    if (roles.includes('ADMIN')) items.push({ id:'admin', label:'School Setup' });
    if (roles.includes('ADMIN') || roles.includes('HEAD')) items.push({ id:'schoolProgress', label:'School Progress' });
    return items;
  }

  function renderShell() {
    const u = state.me.user;
    const nav = navItems().map(n => `<button data-nav="${n.id}">${esc(n.label)}</button>`).join('');
    const chips = roleNames().map(r => `<span class="role-chip">${esc(r)}</span>`).join('');
    app.innerHTML = `
      <div class="shell">
        <aside class="sidebar">
          <div class="side-brand"><div class="brand-mark">ES</div><div><strong>EduSend</strong><div class="tiny">School Results V1</div></div></div>
          <div class="nav">${nav}</div>
          <div class="side-user"><div class="name">${esc(u.name)}</div><div>${chips}</div><button id="logoutBtn" class="btn btn-secondary" style="margin-top:12px;width:100%">Sign out</button></div>
        </aside>
        <main class="main">
          <header class="topbar"><div><h2 id="pageTitle">Dashboard</h2><div class="tiny muted">${esc(state.me.school.name)}</div></div><div class="small"><b>${esc(u.name)}</b></div></header>
          <div id="content" class="content"></div>
        </main>
      </div>`;
    document.querySelectorAll('[data-nav]').forEach(btn => btn.addEventListener('click', () => navigate(btn.dataset.nav)));
    byId('logoutBtn').addEventListener('click', () => logout());
  }

  async function navigate(page) {
    state.page = page;
    document.querySelectorAll('[data-nav]').forEach(b => b.classList.toggle('active', b.dataset.nav === page));
    const titles = { dashboard:'Dashboard', teacher:'My Result Sheets', classTeacher:'Class Results', hodAssignments:'Department Assignments', hodProgress:'Department Progress', admin:'School Setup', schoolProgress:'School Progress' };
    const title = byId('pageTitle'); if (title) title.textContent = titles[page] || 'EduSend';
    const content = byId('content');
    content.innerHTML = '<div class="card">Loading…</div>';
    try {
      if (page === 'dashboard') await renderDashboard(content);
      else if (page === 'teacher') await renderTeacher(content);
      else if (page === 'classTeacher') await renderClassTeacher(content);
      else if (page === 'hodAssignments') await renderHodAssignments(content);
      else if (page === 'hodProgress') await renderHodProgress(content);
      else if (page === 'admin') await renderAdmin(content);
      else if (page === 'schoolProgress') await renderSchoolProgress(content);
    } catch (err) {
      content.innerHTML = `<div class="alert alert-red"><b>Could not load this page.</b><br>${esc(err.message)}</div>`;
    }
  }

  async function renderDashboard(content) {
    const [rem, teacher] = await Promise.all([
      api('/api/reminders'),
      (state.me.user.roles || []).includes('TEACHER') ? api('/api/teacher/assignments') : Promise.resolve({ assignments: [] })
    ]);
    const assignments = teacher.assignments || [];
    const totalSheets = assignments.reduce((n,a) => n + (a.sheets?.length || 0), 0);
    const submitted = assignments.reduce((n,a) => n + (a.sheets || []).filter(s => ['SUBMITTED','LOCKED'].includes(s.status)).length, 0);
    const draft = assignments.reduce((n,a) => n + (a.sheets || []).filter(s => s.status === 'DRAFT').length, 0);
    const classCount = state.me.classTeacherClasses?.length || 0;
    content.innerHTML = `
      ${deadlineBanner(rem.reminders)}
      <div class="grid grid-4">
        <div class="card"><div class="stat">${assignments.length}</div><div class="stat-label">Subject/class assignments</div></div>
        <div class="card"><div class="stat">${submitted}/${totalSheets || 0}</div><div class="stat-label">Result sheets submitted</div></div>
        <div class="card"><div class="stat">${draft}</div><div class="stat-label">Draft sheets</div></div>
        <div class="card"><div class="stat">${classCount}</div><div class="stat-label">Classes where you are class teacher</div></div>
      </div>
      <div class="grid grid-2" style="margin-top:16px">
        <div class="card"><h3>Your access</h3><p class="small">${roleNames().map(esc).join(' • ')}</p><p class="small muted">Subject teachers only receive their assigned result-entry sheets. Class teachers receive submitted results for their own class. HODs manage subject/class assignments in their department.</p></div>
        <div class="card"><h3>Current assessment deadlines</h3>${state.assessments.length ? state.assessments.map(a => `<div class="inline" style="justify-content:space-between;border-top:1px solid #edf0f5;padding:8px 0"><span>${esc(a.name)}</span><b class="small">${fmtDate(a.dueAt)}</b></div>`).join('') : '<div class="empty">No active assessment.</div>'}</div>
      </div>`;
  }

  async function renderTeacher(content) {
    const data = await api('/api/teacher/assignments');
    const rows = [];
    for (const a of data.assignments) {
      for (const s of a.sheets) rows.push({ a, s });
    }
    content.innerHTML = `
      <div class="section-title"><h3>Only your assigned subjects are shown</h3><span class="pill pill-blue">Subject privacy enforced by server</span></div>
      ${rows.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Class</th><th>Subject</th><th>Assessment</th><th>Deadline</th><th>Status</th><th>Last update</th><th></th></tr></thead><tbody>${rows.map(({a,s}) => `
        <tr><td><b>${esc(a.className)}</b></td><td class="subject-cell">${esc(a.subjectName)}</td><td>${esc(s.assessment.name)}</td><td>${fmtDate(s.assessment.dueAt)}</td><td>${statusPill(s.status,s.deadline)}</td><td>${fmtDate(s.updatedAt)}</td><td><button class="action-link" data-open-sheet="${a.id}" data-assessment="${s.assessment.id}">Enter results →</button></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">No subject/class assignment has been given to you yet.</div>'}`;
    document.querySelectorAll('[data-open-sheet]').forEach(b => b.addEventListener('click', () => openResultSheet(b.dataset.openSheet, b.dataset.assessment)));
  }

  async function openResultSheet(assignmentId, assessmentId) {
    const data = await api(`/api/teacher/sheet?assignmentId=${encodeURIComponent(assignmentId)}&assessmentId=${encodeURIComponent(assessmentId)}`);
    const { assignment, assessment, sheet, pupils } = data;
    const rows = pupils.map((p,i) => `<tr><td>${i+1}</td><td><b>${esc(p.name)}</b><div class="tiny muted">${esc(p.sex || '')}</div></td><td>${esc(p.examNo || '—')}</td><td class="center"><input class="mark-input" type="number" min="0" max="100" step="0.1" data-mark="${p.id}" value="${sheet.marks[p.id] ?? ''}" placeholder="—"></td></tr>`).join('');
    showModal(`
      <div class="modal-head"><div><b>${esc(assignment.className)} — ${esc(assignment.subjectName)}</b><div class="tiny muted">${esc(assessment.name)} • Due ${fmtDate(assessment.dueAt)}</div></div><button class="close" data-close>×</button></div>
      <div class="modal-body">
        <div class="alert alert-blue small"><b>Privacy rule:</b> You can enter only ${esc(assignment.subjectName)} for ${esc(assignment.className)}. Other subject marks are not sent to this screen.</div>
        <div class="inline" style="justify-content:space-between;margin-bottom:10px"><div>Status: ${statusPill(sheet.status)}</div><div class="small muted">Blank means no mark entered. Zero is a valid mark.</div></div>
        <div class="table-wrap"><table class="table"><thead><tr><th>#</th><th>Pupil</th><th>Exam No.</th><th class="center">Mark (%)</th></tr></thead><tbody>${rows}</tbody></table></div>
      </div>
      <div class="modal-foot"><button class="btn btn-secondary" data-close>Cancel</button><button id="saveDraft" class="btn btn-secondary" ${sheet.status==='LOCKED'?'disabled':''}>Save Draft</button><button id="submitResults" class="btn btn-green" ${sheet.status==='LOCKED'?'disabled':''}>Submit Results</button></div>`);
    byId('saveDraft')?.addEventListener('click', () => saveSheet(data, 'draft'));
    byId('submitResults')?.addEventListener('click', () => saveSheet(data, 'submit'));
  }

  async function saveSheet(data, action) {
    const marks = [...document.querySelectorAll('[data-mark]')].map(el => ({ pupilId: el.dataset.mark, mark: el.value === '' ? null : Number(el.value) }));
    if (action === 'submit' && !confirm('Submit these results to the class teacher? They will become visible in the class result dashboard immediately.')) return;
    try {
      const result = await api('/api/teacher/sheet', { method:'PUT', body:{ assignmentId:data.assignment.id, assessmentId:data.assessment.id, marks, action } });
      toast(action === 'submit' ? 'Results submitted to the class teacher' : 'Draft saved');
      closeModal();
      await navigate('teacher');
    } catch (err) { toast(err.message, true); }
  }

  async function renderClassTeacher(content) {
    const classesData = await api('/api/class-teacher/classes');
    const classes = classesData.classes || [];
    if (!classes.length) { content.innerHTML = '<div class="empty">You have not been assigned as class teacher.</div>'; return; }
    const assessmentId = state.assessments[0]?.id || '';
    content.innerHTML = `
      <div class="toolbar" style="margin-bottom:14px"><label style="margin:0">Class</label><select id="classSelect" style="width:auto">${classes.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select><label style="margin:0">Assessment</label><select id="assessmentSelect" style="width:auto">${state.assessments.map(a => `<option value="${a.id}">${esc(a.name)}</option>`).join('')}</select><button id="refreshClass" class="btn btn-secondary">Refresh</button></div>
      <div id="classOverview"></div>`;
    const load = () => loadClassOverview(byId('classSelect').value, byId('assessmentSelect').value);
    byId('classSelect').addEventListener('change', load); byId('assessmentSelect').addEventListener('change', load); byId('refreshClass').addEventListener('click', load);
    await load();
  }

  async function loadClassOverview(classId, assessmentId) {
    const holder = byId('classOverview'); if (!holder) return;
    holder.innerHTML = '<div class="card">Loading class results…</div>';
    const d = await api(`/api/class-teacher/overview?classId=${encodeURIComponent(classId)}&assessmentId=${encodeURIComponent(assessmentId)}`);
    const submitted = d.subjects.filter(s => ['SUBMITTED','LOCKED'].includes(s.status)).length;
    const pct = d.subjects.length ? Math.round(submitted / d.subjects.length * 100) : 0;
    const subjectCards = d.subjects.map(s => `<div class="card"><div class="inline" style="justify-content:space-between"><b>${esc(s.subjectName)}</b>${statusPill(s.status,s.deadline)}</div><div class="small muted" style="margin-top:6px">${esc(s.teacherName || 'Unassigned')}</div><div class="tiny muted">${s.submittedAt ? 'Submitted '+fmtDate(s.submittedAt) : s.status==='DRAFT' ? 'Teacher is still entering marks' : 'Waiting for subject teacher'}</div></div>`).join('');
    const headCells = d.subjects.map(s => `<th class="center">${esc(s.subjectName)}</th>`).join('');
    const rows = d.pupils.map((p,i) => `<tr><td>${i+1}</td><td><b>${esc(p.name)}</b><div class="tiny muted">${esc(p.parentPrimary || '')}</div></td>${d.subjects.map(s => `<td class="center">${p.marks[s.subjectId] ?? '—'}</td>`).join('')}</tr>`).join('');
    holder.innerHTML = `
      <div class="grid grid-3" style="margin-bottom:16px"><div class="card"><div class="stat">${submitted}/${d.subjects.length}</div><div class="stat-label">Subjects received</div></div><div class="card"><div class="stat">${pct}%</div><div class="stat-label">Class result completion</div><div class="progressbar" style="margin-top:9px"><span style="width:${pct}%"></span></div></div><div class="card"><div class="stat">${d.pupils.length}</div><div class="stat-label">Pupils in ${esc(d.class.name)}</div></div></div>
      <div class="section-title"><h3>Subject submissions</h3><span class="tiny muted">Updates arrive automatically after a subject teacher submits.</span></div>
      <div class="grid grid-4" style="margin-bottom:16px">${subjectCards}</div>
      <div class="section-title"><h3>Combined class results</h3><span class="pill pill-blue">Submitted subjects only</span></div>
      <div class="table-wrap"><table class="table"><thead><tr><th>#</th><th>Pupil / Parent</th>${headCells}</tr></thead><tbody>${rows}</tbody></table></div>`;
  }

  async function renderHodAssignments(content) {
    const d = await api('/api/hod/assignments');
    content.innerHTML = `
      <div class="alert alert-blue"><b>${esc(d.department.name)} HOD</b> — assign teachers only to subjects belonging to your department.</div>
      <div class="grid grid-2">
        <div class="card"><h3>Assign teacher to class and subject</h3><form id="hodAssignForm" class="stack">
          <div><label>Class</label><select id="hodClass">${d.classes.map(c=>`<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></div>
          <div><label>Subject</label><select id="hodSubject">${d.subjects.map(s=>`<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select></div>
          <div><label>Teacher</label><select id="hodTeacher">${d.teachers.map(t=>`<option value="${t.id}">${esc(t.name)}</option>`).join('')}</select></div>
          <button class="btn btn-primary" type="submit">Save assignment</button>
        </form></div>
        <div class="card"><h3>Department rules</h3><p class="small muted">Once assigned, the teacher sees only that class/subject result sheet. The HOD monitors completion, while class teachers receive submitted results for their own classes.</p></div>
      </div>
      <div class="card" style="margin-top:16px"><h3>Current department assignments</h3><div class="table-wrap"><table class="table"><thead><tr><th>Class</th><th>Subject</th><th>Teacher</th></tr></thead><tbody>${d.assignments.map(a=>`<tr><td>${esc(a.className)}</td><td><b>${esc(a.subjectName)}</b></td><td>${esc(a.teacherName)}</td></tr>`).join('')}</tbody></table></div></div>`;
    byId('hodAssignForm').addEventListener('submit', async e => {
      e.preventDefault();
      try {
        await api('/api/hod/assign', { method:'POST', body:{ classId:byId('hodClass').value, subjectId:byId('hodSubject').value, teacherUserId:byId('hodTeacher').value } });
        toast('Teacher assignment saved'); await renderHodAssignments(content);
      } catch(err){ toast(err.message,true); }
    });
  }

  async function renderHodProgress(content) {
    if (!state.assessments.length) { content.innerHTML='<div class="empty">No assessment.</div>'; return; }
    content.innerHTML = `<div class="toolbar" style="margin-bottom:14px"><label style="margin:0">Assessment</label><select id="hodAssess" style="width:auto">${state.assessments.map(a=>`<option value="${a.id}">${esc(a.name)}</option>`).join('')}</select></div><div id="hodProgressBody"></div>`;
    const load = async () => {
      const d = await api(`/api/hod/progress?assessmentId=${encodeURIComponent(byId('hodAssess').value)}`);
      const done = d.rows.filter(r=>['SUBMITTED','LOCKED'].includes(r.status)).length;
      const overdue = d.rows.filter(r=>r.deadline.code==='OVERDUE').length;
      byId('hodProgressBody').innerHTML = `<div class="grid grid-3" style="margin-bottom:16px"><div class="card"><div class="stat">${done}/${d.rows.length}</div><div class="stat-label">Department sheets submitted</div></div><div class="card"><div class="stat">${overdue}</div><div class="stat-label">Overdue sheets</div></div><div class="card"><div class="stat">${d.rows.length-done}</div><div class="stat-label">Still outstanding</div></div></div><div class="table-wrap"><table class="table"><thead><tr><th>Class</th><th>Subject</th><th>Teacher</th><th>Status</th><th>Deadline</th><th>Updated</th></tr></thead><tbody>${d.rows.map(r=>`<tr><td>${esc(r.className)}</td><td><b>${esc(r.subjectName)}</b></td><td>${esc(r.teacherName)}</td><td>${statusPill(r.status,r.deadline)}</td><td>${fmtDate(d.assessment.dueAt)}</td><td>${fmtDate(r.updatedAt)}</td></tr>`).join('')}</tbody></table></div>`;
    };
    byId('hodAssess').addEventListener('change', load); await load();
  }

  async function renderAdmin(content) {
    const d = await api('/api/admin/setup');
    const teachers = d.users.filter(u => (u.roles || []).includes('TEACHER'));
    content.innerHTML = `
      <div class="grid grid-2">
        <div class="card"><h3>Add staff account</h3><form id="addUserForm" class="form-grid">
          <div><label>Name</label><input id="newName" required></div><div><label>Username</label><input id="newUsername" required></div>
          <div><label>Temporary password</label><input id="newPassword" value="change123" required></div><div><label>Department</label><select id="newDept"><option value="">None</option>${d.departments.map(x=>`<option value="${x.id}">${esc(x.name)}</option>`).join('')}</select></div>
          <div class="span-2"><label>Role</label><select id="newRole"><option value="TEACHER">Teacher</option><option value="HOD_TEACHER">HOD + Teacher</option><option value="HEAD">Head Teacher</option></select></div>
          <button class="btn btn-primary span-2" type="submit">Create account</button>
        </form></div>
        <div class="card"><h3>Assign class teacher</h3><form id="classTeacherForm" class="stack"><div><label>Class</label><select id="ctClass">${d.classes.map(c=>`<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></div><div><label>Class teacher</label><select id="ctTeacher">${teachers.map(t=>`<option value="${t.id}">${esc(t.name)}</option>`).join('')}</select></div><button class="btn btn-primary" type="submit">Assign class teacher</button></form></div>
        <div class="card"><h3>Create class</h3><form id="classForm" class="stack"><div><label>Class name</label><input id="className" placeholder="e.g. 11A" required></div><div><label>Level</label><input id="classLevel" placeholder="e.g. Grade 11"></div><div><label>Grading system</label><select id="classGrading"><option value="CBC">CBC Grades 1–5</option><option value="LEGACY">Existing/legacy scale</option></select></div><button class="btn btn-primary">Create class</button></form></div>
        <div class="card"><h3>Create assessment & deadline</h3><form id="assessmentForm" class="stack"><div><label>Assessment name</label><input id="assessName" placeholder="e.g. Term 3 Week 8 Assessment" required></div><div><label>Term</label><input id="assessTerm" placeholder="Term 3"></div><div><label>Year</label><input id="assessYear" type="number" value="${new Date().getFullYear()}"></div><div><label>Results deadline</label><input id="assessDue" type="datetime-local" required></div><button class="btn btn-primary">Create assessment</button></form></div>
      </div>
      <div class="card" style="margin-top:16px"><h3>Classes</h3><div class="table-wrap"><table class="table"><thead><tr><th>Class</th><th>Level</th><th>Grading</th><th>Class teacher</th></tr></thead><tbody>${d.classes.map(c=>{const t=d.users.find(u=>u.id===c.classTeacherUserId);return `<tr><td><b>${esc(c.name)}</b></td><td>${esc(c.level)}</td><td>${esc(c.gradingSystem)}</td><td>${esc(t?.name||'Not assigned')}</td></tr>`}).join('')}</tbody></table></div></div>`;
    byId('addUserForm').addEventListener('submit', async e => {e.preventDefault();const role=byId('newRole').value;try{await api('/api/admin/user',{method:'POST',body:{name:byId('newName').value,username:byId('newUsername').value,password:byId('newPassword').value,departmentId:byId('newDept').value||null,roles:role==='HOD_TEACHER'?['HOD','TEACHER']:[role]}});toast('Staff account created');await renderAdmin(content)}catch(err){toast(err.message,true)}});
    byId('classTeacherForm').addEventListener('submit', async e => {e.preventDefault();try{await api('/api/admin/class-teacher',{method:'POST',body:{classId:byId('ctClass').value,teacherUserId:byId('ctTeacher').value}});toast('Class teacher assigned');await bootstrap()}catch(err){toast(err.message,true)}});
    byId('classForm').addEventListener('submit', async e => {e.preventDefault();try{await api('/api/admin/class',{method:'POST',body:{name:byId('className').value,level:byId('classLevel').value,gradingSystem:byId('classGrading').value}});toast('Class created');await renderAdmin(content)}catch(err){toast(err.message,true)}});
    byId('assessmentForm').addEventListener('submit', async e => {e.preventDefault();try{const due=new Date(byId('assessDue').value).toISOString();await api('/api/admin/assessment',{method:'POST',body:{name:byId('assessName').value,term:byId('assessTerm').value,year:byId('assessYear').value,dueAt:due}});toast('Assessment created');const a=await api('/api/assessments');state.assessments=a.assessments;await renderAdmin(content)}catch(err){toast(err.message,true)}});
  }

  async function renderSchoolProgress(content) {
    if (!state.assessments.length) { content.innerHTML='<div class="empty">No assessment.</div>'; return; }
    content.innerHTML = `<div class="toolbar" style="margin-bottom:14px"><label style="margin:0">Assessment</label><select id="schoolAssess" style="width:auto">${state.assessments.map(a=>`<option value="${a.id}">${esc(a.name)}</option>`).join('')}</select></div><div id="schoolProgressBody"></div>`;
    const load = async () => {
      const d=await api(`/api/school/progress?assessmentId=${encodeURIComponent(byId('schoolAssess').value)}`);
      const done=d.rows.filter(r=>['SUBMITTED','LOCKED'].includes(r.status)).length;const overdue=d.rows.filter(r=>r.deadline.code==='OVERDUE').length;
      const deptMap={};d.rows.forEach(r=>{const k=r.departmentName||'Other';deptMap[k]=deptMap[k]||{total:0,done:0};deptMap[k].total++;if(['SUBMITTED','LOCKED'].includes(r.status))deptMap[k].done++});
      byId('schoolProgressBody').innerHTML=`<div class="grid grid-3" style="margin-bottom:16px"><div class="card"><div class="stat">${done}/${d.rows.length}</div><div class="stat-label">School result sheets submitted</div></div><div class="card"><div class="stat">${overdue}</div><div class="stat-label">Overdue sheets</div></div><div class="card"><div class="stat">${d.rows.length-done}</div><div class="stat-label">Outstanding sheets</div></div></div><div class="grid grid-4" style="margin-bottom:16px">${Object.entries(deptMap).map(([k,v])=>`<div class="card"><b>${esc(k)}</b><div class="stat" style="font-size:22px;margin-top:7px">${v.done}/${v.total}</div><div class="stat-label">submitted</div></div>`).join('')}</div><div class="table-wrap"><table class="table"><thead><tr><th>Department</th><th>Class</th><th>Subject</th><th>Teacher</th><th>Status</th><th>Updated</th></tr></thead><tbody>${d.rows.map(r=>`<tr><td>${esc(r.departmentName)}</td><td>${esc(r.className)}</td><td><b>${esc(r.subjectName)}</b></td><td>${esc(r.teacherName)}</td><td>${statusPill(r.status,r.deadline)}</td><td>${fmtDate(r.updatedAt)}</td></tr>`).join('')}</tbody></table></div>`;
    };
    byId('schoolAssess').addEventListener('change',load);await load();
  }

  function showModal(html) {
    closeModal();
    const wrap = document.createElement('div'); wrap.className='modal-backdrop'; wrap.id='modalBackdrop'; wrap.innerHTML=`<div class="modal">${html}</div>`; document.body.appendChild(wrap);
    wrap.addEventListener('click', e => { if (e.target===wrap || e.target.matches('[data-close]')) closeModal(); });
  }
  function closeModal(){ byId('modalBackdrop')?.remove(); }

  function connectEvents() {
    disconnectEvents();
    if (!state.token) return;
    const es = new EventSource(`/api/events?token=${encodeURIComponent(state.token)}`);
    state.eventSource = es;
    es.addEventListener('update', async (e) => {
      let data={};try{data=JSON.parse(e.data)}catch{}
      if (state.page==='classTeacher' && data.type==='RESULT_SHEET_UPDATED') {
        const c=byId('classSelect'),a=byId('assessmentSelect'); if(c&&a&&c.value===data.classId&&a.value===data.assessmentId) await loadClassOverview(c.value,a.value);
      }
      if (state.page==='hodProgress' && data.type==='RESULT_SHEET_UPDATED') navigate('hodProgress');
      if (state.page==='schoolProgress' && data.type==='RESULT_SHEET_UPDATED') navigate('schoolProgress');
    });
    state.refreshTimer = setInterval(() => {
      if (state.page==='classTeacher') { const c=byId('classSelect'),a=byId('assessmentSelect'); if(c&&a) loadClassOverview(c.value,a.value).catch(()=>{}); }
    }, 15000);
  }
  function disconnectEvents(){ if(state.eventSource){state.eventSource.close();state.eventSource=null} if(state.refreshTimer){clearInterval(state.refreshTimer);state.refreshTimer=null} }

  if (state.token) bootstrap(); else renderLogin();
})();
