const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'docs.json');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');
const crypto = require('crypto');

function ensureDataDir(){
  if(!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if(!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, '[]', 'utf8');
}

function loadDocs(){
  try{
    ensureDataDir();
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    return JSON.parse(raw || '[]');
  }catch(e){
    console.error('Failed reading docs:', e);
    return [];
  }
}

function ensureUsers(){
  if(!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if(!fs.existsSync(USERS_FILE)){
    // create an empty users array so registrations can append safely
    try{ fs.writeFileSync(USERS_FILE, JSON.stringify([], null, 2), 'utf8'); }catch(e){ console.error('create users file failed', e); }
  }
  if(!fs.existsSync(SESSIONS_FILE)){
    try{ fs.writeFileSync(SESSIONS_FILE, JSON.stringify({}), 'utf8'); }catch(e){ console.error('create sessions file failed', e); }
  }
}

function loadUsers(){ try{ ensureUsers(); return JSON.parse(fs.readFileSync(USERS_FILE,'utf8')||'[]'); }catch(e){console.error('users load',e); return [];}}
function saveUsers(u){ try{ ensureUsers(); fs.writeFileSync(USERS_FILE, JSON.stringify(u,null,2),'utf8'); return true;}catch(e){console.error(e);return false;} }
function loadSessions(){ try{ ensureUsers(); return JSON.parse(fs.readFileSync(SESSIONS_FILE,'utf8')||'{}'); }catch(e){console.error('sessions load',e); return {}; } }
function saveSessions(s){ try{ ensureUsers(); fs.writeFileSync(SESSIONS_FILE, JSON.stringify(s,null,2),'utf8'); return true; }catch(e){console.error('sessions save',e); return false; } }

function parseCookies(req){ const h = req.headers.cookie || ''; return h.split(';').map(s=>s.trim()).filter(Boolean).reduce((acc,p)=>{ const idx=p.indexOf('='); if(idx>0) acc[p.slice(0,idx)]=decodeURIComponent(p.slice(idx+1)); return acc; },{}); }

function getSessionFromReq(req){ const cookies = parseCookies(req); const sid = cookies.sid || (req.headers.authorization && req.headers.authorization.replace('Bearer ','' ) ); if(!sid) return null; const sessions = loadSessions(); const s = sessions[sid]; if(!s) return null; if(s.expires && s.expires < Date.now()){ delete sessions[sid]; saveSessions(sessions); return null; } return s; }

function createSessionForUser(userId){ const token = crypto.randomBytes(24).toString('hex'); const sessions = loadSessions(); sessions[token] = { userId, created: Date.now(), expires: Date.now() + (1000*60*60*8) }; saveSessions(sessions); return token; }

function saveDocs(docs){
  try{
    ensureDataDir();
    fs.writeFileSync(DATA_FILE, JSON.stringify(docs, null, 2), 'utf8');
    return true;
  }catch(e){
    console.error('Failed saving docs:', e);
    return false;
  }
}

// Serve static public folder
app.use(express.static(path.join(__dirname, 'public')));

// AUTH: login / me / logout
app.post('/api/login', (req, res) => {
  try {
    const filePath = USERS_FILE; // data/users.json
    if (!fs.existsSync(filePath)) {
      return res.status(400).json({ success: false, message: 'ไม่พบบัญชีผู้ใช้งาน' });
    }
    const users = JSON.parse(fs.readFileSync(filePath, 'utf8') || '[]');
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ success: false, message: 'missing credentials' });
    const user = users.find(u => u.username === username && u.password === password);
    if (user) {
      const token = createSessionForUser(user.id);
      try { res.cookie && res.cookie('sid', token, { httpOnly: true, sameSite: 'lax' }); } catch (e) { console.error('cookie set failed', e); }
      return res.json({ success: true, user: { id: user.id, username: user.username, name: user.name, roleIndex: user.roleIndex } });
    } else {
      return res.status(400).json({ success: false, message: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' });
    }
  } catch (error) {
    console.error('/api/login error', error);
    return res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาด' });
  }
});

// API: register new user
app.post('/api/register', (req, res) => {
  try {
    const filePath = USERS_FILE; // data/users.json
    let users = [];

    // ถ้าไม่มีไฟล์ users.json ให้สร้างไฟล์ขึ้นมาใหม่เป็นอาร์เรย์ว่าง
    if (!fs.existsSync(filePath)) {
      ensureUsers(); // create data dir and files
      fs.writeFileSync(filePath, JSON.stringify([], null, 2), 'utf8');
    }

    // อ่านข้อมูลเก่าออกมา
    const fileData = fs.readFileSync(filePath, 'utf8');
    users = JSON.parse(fileData || '[]');

    // รับข้อมูลจากหน้าบ้าน
    const { fullName, position, role, username, password } = req.body || {};
    if (!fullName || !position || typeof role === 'undefined' || !username || !password) {
      return res.status(400).json({ success: false, message: 'กรุณากรอกข้อมูลให้ครบถ้วน' });
    }

    // เช็กว่า Username ซ้ำไหม
    const userExists = users.some(u => u.username === username);
    if (userExists) {
      return res.status(400).json({ success: false, message: 'Username นี้ถูกใช้งานแล้ว' });
    }

    // เพิ่มยูสเซอร์ใหม่เข้าไปและเซฟไฟล์
    const id = 'u-' + Date.now();
    const newUser = {
      id,
      fullName,
      position,
      username,
      password,
      role: Number(role),
      roleIndex: Number(role)
    };
    users.push(newUser);
    fs.writeFileSync(filePath, JSON.stringify(users, null, 2), 'utf8');

    return res.json({ success: true, message: 'สมัครสมาชิกสำเร็จ' });
  } catch (error) {
    console.error('/api/register error', error);
    return res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดบนเซิร์ฟเวอร์' });
  }
});

app.get('/api/me', (req, res) => {
  const s = getSessionFromReq(req);
  if(!s) return res.json({ user: null });
  const users = loadUsers();
  const user = users.find(u => u.id === s.userId);
  if(!user) return res.json({ user: null });
  res.json({ user: { id: user.id, username: user.username, name: user.name, roleIndex: user.roleIndex } });
});

app.post('/api/logout', (req, res) => {
  const cookies = parseCookies(req); const sid = cookies.sid;
  if(sid){ const sessions = loadSessions(); delete sessions[sid]; saveSessions(sessions); }
  res.clearCookie && res.clearCookie('sid');
  res.json({ ok: true });
});

// API: list documents
app.get('/api/docs', (req, res) => {
  const docs = loadDocs();
  res.json(docs);
});

// API: get single doc by id
app.get('/api/docs/:id', (req, res) => {
  const docs = loadDocs();
  const doc = docs.find(d => d.id === req.params.id);
  if(!doc) return res.status(404).json({ error: 'not found' });
  res.json(doc);
});

// API: create new document
app.post('/api/docs', (req, res) => {
  const { title, author, urgent, files } = req.body;
  const s = getSessionFromReq(req);
  if(!s) return res.status(401).json({ error: 'unauthenticated' });
  const users = loadUsers(); const u = users.find(x=>x.id===s.userId);
  if(!title) return res.status(400).json({ error: 'missing title' });

  const docs = loadDocs();
  const seq = docs.reduce((m,d)=> Math.max(m, d.seq||0), 0) + 1;
  const beYear = new Date().getFullYear() + 543;
  const docNo = `ที่ อบต.พล ${seq}/${beYear}`;

  const LEVELS_COUNT = 7;
  const chain = Array.from({length:LEVELS_COUNT}).map((_,i)=>({
    name: i===0 ? (author || '') : '',
    date: '',
    note: '',
    state: i===0 ? 'active' : 'wait',
    files: i===0 ? (files || []) : [],
    signature: null
  }));

  // set author to logged-in user if not provided
  if(u && !author) chain[0].name = u.name;
  const doc = { id: String(Date.now()), seq, no: docNo, title, urgent: !!urgent, chain };
  docs.unshift(doc);
  saveDocs(docs);
  res.json(doc);
});

// API: forward a step (mark current index done, activate next)
app.post('/api/docs/:id/forward', (req, res) => {
  const { idx, text, signature, files } = req.body;
  if(typeof idx !== 'number') return res.status(400).json({ error: 'missing idx' });
  const s = getSessionFromReq(req); if(!s) return res.status(401).json({ error: 'unauthenticated' });
  const users = loadUsers(); const user = users.find(u=>u.id===s.userId);
  const docs = loadDocs();
  const doc = docs.find(d => d.id === req.params.id);
  if(!doc) return res.status(404).json({ error: 'not found' });

  const i = idx;
  if(!doc.chain[i]) return res.status(400).json({ error: 'invalid idx' });
  // permission: only the user assigned to this level or admin (-1) can forward
  if(!(user && (user.roleIndex === -1 || user.roleIndex === i))){ return res.status(403).json({ error: 'forbidden' }); }

  doc.chain[i].note = text || doc.chain[i].note;
  doc.chain[i].date = new Date().toLocaleDateString('th-TH');
  doc.chain[i].state = 'done';
  if(signature) doc.chain[i].signature = signature;
  if(Array.isArray(files) && files.length) doc.chain[i].files = (doc.chain[i].files||[]).concat(files);

  if(i+1 < doc.chain.length){
    doc.chain[i+1].state = 'active';
  }

  saveDocs(docs);
  res.json(doc);
});

// API: send back to previous step
app.post('/api/docs/:id/back', (req, res) => {
  const { idx } = req.body;
  if(typeof idx !== 'number') return res.status(400).json({ error: 'missing idx' });
  const s = getSessionFromReq(req); if(!s) return res.status(401).json({ error: 'unauthenticated' });
  const users = loadUsers(); const user = users.find(u=>u.id===s.userId);
  const docs = loadDocs();
  const doc = docs.find(d => d.id === req.params.id);
  if(!doc) return res.status(404).json({ error: 'not found' });
  const i = idx;
  if(!doc.chain[i] || i-1 < 0) return res.status(400).json({ error: 'invalid idx' });
  if(!(user && (user.roleIndex === -1 || user.roleIndex === i))){ return res.status(403).json({ error: 'forbidden' }); }

  doc.chain[i].state = 'wait';
  doc.chain[i].note = '';
  doc.chain[i].date = '';
  doc.chain[i].signature = null;
  doc.chain[i-1].state = 'active';

  saveDocs(docs);
  res.json(doc);
});

// API: update document (partial)
app.put('/api/docs/:id', (req, res) => {
  const docs = loadDocs();
  const doc = docs.find(d => d.id === req.params.id);
  if(!doc) return res.status(404).json({ error: 'not found' });
  Object.assign(doc, req.body);
  saveDocs(docs);
  res.json(doc);
});

// Fallback to index.html for SPA routes (use app.use to avoid path-to-regexp)
app.use((req, res) => {
  const index = path.join(__dirname, 'public', 'index.html');
  if(fs.existsSync(index)) return res.sendFile(index);
  res.status(404).send('Not found');
});

app.listen(PORT, '0.0.0.0', () => {
  console.log('Server is running on http://0.0.0.0:' + PORT);
});