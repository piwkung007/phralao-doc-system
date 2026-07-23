const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
// [FIX] เดิม express.json()/express.urlencoded() ไม่ได้กำหนด limit ไว้ ทำให้ใช้ค่า
// default ของ Express ซึ่งคือแค่ "100kb" ต่อคำขอหนึ่งครั้ง — ไฟล์แนบ (รูป/PDF) ที่แปลงเป็น
// base64 ฝั่งหน้าเว็บ แทบทุกไฟล์มีขนาดเกิน 100kb อยู่แล้วตั้งแต่ไฟล์เดียว จึงถูกเซิร์ฟเวอร์
// ปฏิเสธคำขอทันทีทุกครั้งที่มีการแนบไฟล์ (ทั้งตอนสร้างหนังสือใหม่ และตอนแนบไฟล์ระหว่างเกษียน)
// นี่คือสาเหตุจริงของ "ไม่สามารถสร้างหนังสือได้" และ "แนบไฟล์ไม่ได้เลย" — ไม่ใช่เรื่องสิทธิ์
// จึงขยาย limit ให้รองรับไฟล์แนบขนาดใหญ่ขึ้น (รวมทุกไฟล์ในคำขอเดียวไม่เกิน 50MB)
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// [FIX] เมื่อคำขอมีขนาดเกิน limit (หรือ JSON ผิดรูปแบบ) เดิม Express จะตอบกลับเป็นหน้า
// error ที่ไม่ใช่ JSON ทำให้ฝั่งหน้าเว็บ parse ไม่ออกและขึ้นข้อความกลางๆ ที่ไม่บอกสาเหตุจริง
// เพิ่ม middleware นี้เพื่อให้ตอบกลับเป็น JSON ที่มีข้อความชัดเจน ผู้ใช้จะได้เห็นสาเหตุจริง
app.use((err, req, res, next) => {
  if (err && err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'ไฟล์แนบมีขนาดใหญ่เกินไป กรุณาแนบไฟล์ที่มีขนาดเล็กลง (รวมทุกไฟล์ไม่เกิน 50MB ต่อครั้ง)' });
  }
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'ข้อมูลที่ส่งมาไม่ถูกต้อง กรุณาลองใหม่อีกครั้ง' });
  }
  next(err);
});

const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'docs.json');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');
// ไฟล์เก็บข้อมูล 2 ระบบใหม่: ขอเลขหนังสือส่ง / ขอเลขคำสั่ง
const SEND_NUM_FILE = path.join(DATA_DIR, 'send_numbers.json');
const ORDER_NUM_FILE = path.join(DATA_DIR, 'order_numbers.json');

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
    try{ fs.writeFileSync(USERS_FILE, JSON.stringify([], null, 2), 'utf8'); }catch(e){ console.error('create users file failed', e); }
  }
  if(!fs.existsSync(SESSIONS_FILE)){
    try{ fs.writeFileSync(SESSIONS_FILE, JSON.stringify({}, null, 2), 'utf8'); }catch(e){ console.error('create sessions file failed', e); }
  }
}

function loadUsers(){ try{ ensureUsers(); return JSON.parse(fs.readFileSync(USERS_FILE,'utf8')||'[]'); }catch(e){console.error('users load',e); return [];} }
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

// ตัวช่วยจัดการไฟล์สำหรับ "ขอเลขหนังสือส่ง"
function ensureSendNumFile(){
  if(!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if(!fs.existsSync(SEND_NUM_FILE)) fs.writeFileSync(SEND_NUM_FILE, '[]', 'utf8');
}
function loadSendNumbers(){
  try{ ensureSendNumFile(); return JSON.parse(fs.readFileSync(SEND_NUM_FILE,'utf8')||'[]'); }
  catch(e){ console.error('send numbers load failed', e); return []; }
}
function saveSendNumbers(list){
  try{ ensureSendNumFile(); fs.writeFileSync(SEND_NUM_FILE, JSON.stringify(list,null,2), 'utf8'); return true; }
  catch(e){ console.error('send numbers save failed', e); return false; }
}

// ตัวช่วยจัดการไฟล์สำหรับ "ขอเลขคำสั่ง"
function ensureOrderNumFile(){
  if(!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if(!fs.existsSync(ORDER_NUM_FILE)) fs.writeFileSync(ORDER_NUM_FILE, '[]', 'utf8');
}
function loadOrderNumbers(){
  try{ ensureOrderNumFile(); return JSON.parse(fs.readFileSync(ORDER_NUM_FILE,'utf8')||'[]'); }
  catch(e){ console.error('order numbers load failed', e); return []; }
}
function saveOrderNumbers(list){
  try{ ensureOrderNumFile(); fs.writeFileSync(ORDER_NUM_FILE, JSON.stringify(list,null,2), 'utf8'); return true; }
  catch(e){ console.error('order numbers save failed', e); return false; }
}

function ensureSeedUsers(){
  const users = loadUsers();
  const existing = users.find(u => u.username === 'piwkung007');
  if(!existing){
    users.unshift({
      id: 'u-superadmin',
      fullName: 'Super Admin',
      position: 'Administrator',
      username: 'piwkung007',
      password: 'piwkung007',
      role: -1,
      roleIndex: -1,
      isSuperAdmin: true
    });
    saveUsers(users);
    return;
  }
  if(existing.roleIndex !== -1 || existing.role !== -1 || !existing.isSuperAdmin){
    existing.role = -1;
    existing.roleIndex = -1;
    existing.isSuperAdmin = true;
    saveUsers(users);
  }
}

function isSuperAdminUser(user){
  return Boolean(user && (user.isSuperAdmin || user.username === 'piwkung007' || user.roleIndex === -1));
}

// ผู้ใช้ที่ล็อกอินอยู่ (ได้รับบัญชีจากแอดมิน) ไม่ว่าตำแหน่งใด
// สามารถเกษียน/ตีกลับได้ทุกขั้นตอนในสาย ไม่จำกัดลำดับตำแหน่ง
function canActOnStep(user, stepIdx){
  return Boolean(user);
}

function buildUserPayload(user){
  return {
    id: user.id,
    username: user.username,
    name: user.fullName || user.name || user.username,
    fullName: user.fullName,
    position: user.position,
    roleIndex: isSuperAdminUser(user) ? -1 : Number(user.roleIndex),
    role: user.role,
    isSuperAdmin: isSuperAdminUser(user)
  };
}

app.use(express.static(path.join(__dirname, 'public')));

// AUTH: login / me / logout
app.post('/api/login', (req, res) => {
  try {
    ensureSeedUsers();
    const filePath = USERS_FILE;
    if (!fs.existsSync(filePath)) {
      return res.status(400).json({ success: false, message: 'ไม่พบชื่อบัญชีผู้ใช้งาน' });
    }
    const users = JSON.parse(fs.readFileSync(filePath, 'utf8') || '[]');
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ success: false, message: 'missing credentials' });
    const user = users.find(u => u.username === username && u.password === password);
    if (user) {
      const token = createSessionForUser(user.id);
      try { res.cookie && res.cookie('sid', token, { httpOnly: true, sameSite: 'lax' }); } catch (e) { console.error('cookie set failed', e); }
      return res.json({ success: true, user: buildUserPayload(user) });
    } else {
      return res.status(400).json({ success: false, message: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' });
    }
  } catch (error) {
    console.error('/api/login error', error);
    return res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาด' });
  }
});
// ==========================================
// API สมัครสมาชิก (จำกัดสิทธิ์เฉพาะแอดมิน piwkung007)
// ==========================================

// 🔥 API: register new user (ล็อกสิทธิ์เฉพาะ Super Admin เท่านั้น)
app.post('/api/register', (req, res) => {
  try {
    // 1. ตรวจสอบ Session คนที่กำลังเรียกใช้งานระบบ (ระบบเดิมของน้อง)
    const s = getSessionFromReq(req);
    if (!s) {
      return res.status(401).json({ success: false, message: 'ปฏิเสธสิทธิ์: กรุณาเข้าสู่ระบบก่อนทำรายการ' });
    }

    // 2. ดึงข้อมูล User จากระบบมาเช็กสิทธิ์
    const usersList = loadUsers();
    const currentUser = usersList.find(u => u.id === s.userId);

    // 3. ตรวจสอบว่าเป็น Super Admin (piwkung007) หรือไม่
    if (!currentUser || currentUser.username !== 'piwkung007') {
      return res.status(403).json({ 
        success: false, 
        message: 'ปฏิเสธสิทธิ์: เฉพาะ Super Admin (piwkung007) เท่านั้นที่สามารถสมัครสมาชิกให้ผู้อื่นได้!' 
      });
    }

    // 4. รับข้อมูลจากฟอร์มหน้าบ้าน (ชื่อ, ตำแหน่ง, สิทธิ์, Username, Password)
    const { fullName, position, role, username, password } = req.body;
    if (!username || !password || !fullName || !position) {
      return res.json({ success: false, error: 'กรุณากรอกข้อมูลให้ครบถ้วน' });
    }

    // 5. ตรวจสอบว่ามีชื่อผู้ใช้นี้อยู่แล้วหรือยัง
    const existingUser = usersList.find(u => u.username === username);
    if (existingUser) {
      return res.json({ success: false, error: 'มีชื่อผู้ใช้นี้อยู่ในระบบแล้ว' });
    }

    // 6. สร้างข้อมูลผู้ใช้ใหม่พร้อมฟิลด์ครบถ้วนเก็บลงไฟล์
    const roleIndexNum = Number(role);
    const newUser = {
      id: Date.now().toString(),
      username: username,
      password: password,
      fullName: fullName,
      position: position,
      role: role,
      roleIndex: Number.isNaN(roleIndexNum) ? 0 : roleIndexNum,
      isSuperAdmin: false
    };

    // 7. บันทึกข้อมูลกลับลงระบบ
    usersList.push(newUser);

    if (typeof saveUsers === 'function') {
      saveUsers(usersList);
    } else {
      const fs = require('fs');
      fs.writeFileSync('./users.json', JSON.stringify(usersList, null, 2), 'utf8');
    }

    return res.json({ success: true });
  } catch (err) {
    console.error('Register error:', err);
    return res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการบันทึกข้อมูล' });
  }
});

app.get('/api/me', (req, res) => {
  const s = getSessionFromReq(req);
  if(!s) return res.json({ user: null });
  const users = loadUsers();
  const user = users.find(u => u.id === s.userId);
  if(!user) return res.json({ user: null });
  res.json({ user: buildUserPayload(user) });
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
            state: 'active', // ✅ เปลี่ยนเป็น active ทั้งหมด เพื่อให้ทุกขั้นเปิดพร้อมใช้งานทันที ไม่ต้องรอคิว
            files: i===0 ? (files || []) : [],
            signature: null
        }));

  if(u && !author) chain[0].name = u.fullName || u.name || u.username;
  const doc = { id: String(Date.now()), seq, no: docNo, title, urgent: !!urgent, chain };
  docs.unshift(doc);
  saveDocs(docs);
  res.json(doc);
});

// API: forward a step
app.post('/api/docs/:id/forward', (req, res) => {
  const { idx, text, signature, files, actorName } = req.body;
  if(typeof idx !== 'number') return res.status(400).json({ error: 'missing idx' });
  const s = getSessionFromReq(req); if(!s) return res.status(401).json({ error: 'unauthenticated' });
  const users = loadUsers(); const user = users.find(u=>u.id===s.userId);
  const docs = loadDocs();
  const doc = docs.find(d => d.id === req.params.id);
  if(!doc) return res.status(404).json({ error: 'not found' });

  const i = idx;
  if(!doc.chain[i]) return res.status(400).json({ error: 'invalid idx' });
  // ใครก็ตามที่ล็อกอินอยู่ ทำขั้นตอนไหนก็ได้ (ดู canActOnStep ด้านบน)
  if(!canActOnStep(user, i)){ return res.status(403).json({ error: 'forbidden' }); }

  // บันทึกชื่อผู้เกษียนจากช่องที่กรอกในป๊อปอัพฝั่งหน้าเว็บ (actorName)
  // เพราะตอนนี้ใครก็เกษียนขั้นไหนก็ได้ ชื่อที่ขึ้นในเอกสารจึงต้องระบุเองว่าใครเป็นผู้เกษียนจริง
  // ถ้าไม่ได้ส่ง actorName มา (เช่น เรียก API ตรงๆ) จะ fallback ไปใช้ชื่อบัญชีที่ล็อกอินแทน
  const trimmedActorName = (typeof actorName === 'string') ? actorName.trim() : '';
  doc.chain[i].name = trimmedActorName || (user && (user.fullName || user.name || user.username)) || doc.chain[i].name;

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
  // ใครก็ตามที่ล็อกอินอยู่ ตีกลับขั้นตอนไหนก็ได้เช่นกัน
  if(!canActOnStep(user, i)){ return res.status(403).json({ error: 'forbidden' }); }

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

// API: delete a document (admin only)
app.delete('/api/docs/:id', (req, res) => {
  const s = getSessionFromReq(req);
  if(!s) return res.status(401).json({ error: 'unauthenticated' });
  const users = loadUsers();
  const user = users.find(u => u.id === s.userId);
  if(!isSuperAdminUser(user)) return res.status(403).json({ error: 'forbidden: admin only' });

  const docs = loadDocs();
  const idx = docs.findIndex(d => d.id === req.params.id);
  if(idx === -1) return res.status(404).json({ error: 'not found' });

  const [removed] = docs.splice(idx, 1);
  saveDocs(docs);
  res.json({ ok: true, id: removed.id });
});

// ==========================================
// API: ขอเลขหนังสือส่ง — ออกเลขทะเบียนอัตโนมัติ เรียงต่อกันไม่ให้หลงเลข
// ==========================================
app.get('/api/sendnumbers', (req, res) => {
  const list = loadSendNumbers();
  res.json(list);
});
app.post('/api/sendnumbers', (req, res) => {
  const s = getSessionFromReq(req);
  if(!s) return res.status(401).json({ error: 'unauthenticated' });
  const users = loadUsers(); const user = users.find(u => u.id === s.userId);
  const { at, date, from, to, subject, action, note } = req.body || {};
  if(!subject) return res.status(400).json({ error: 'กรุณาระบุเรื่อง' });

  const list = loadSendNumbers();
  const nextNum = list.reduce((m, r) => Math.max(m, Number(r.num) || 0), 0) + 1;
  const record = {
    num: nextNum,
    at: at || '',
    date: date || '',
    from: from || '',
    to: to || '',
    subject: subject || '',
    action: action || '',
    note: note || '',
    requestedBy: user ? (user.fullName || user.name || user.username) : '',
    createdAt: Date.now()
  };
  list.push(record);
  saveSendNumbers(list);
  res.json(record);
});

// ==========================================
// API: ขอเลขคำสั่ง — ออกเลขที่คำสั่งอัตโนมัติ เรียงต่อกันไม่ให้หลงเลข
// ==========================================
app.get('/api/ordernumbers', (req, res) => {
  const list = loadOrderNumbers();
  res.json(list);
});
app.post('/api/ordernumbers', (req, res) => {
  const s = getSessionFromReq(req);
  if(!s) return res.status(401).json({ error: 'unauthenticated' });
  const users = loadUsers(); const user = users.find(u => u.id === s.userId);
  const { date, subject, from, note } = req.body || {};
  if(!subject) return res.status(400).json({ error: 'กรุณาระบุเรื่อง' });

  const list = loadOrderNumbers();
  const nextNum = list.reduce((m, r) => Math.max(m, Number(r.num) || 0), 0) + 1;
  const record = {
    num: nextNum,
    date: date || '',
    subject: subject || '',
    from: from || '',
    note: note || '',
    requestedBy: user ? (user.fullName || user.name || user.username) : '',
    createdAt: Date.now()
  };
  list.push(record);
  saveOrderNumbers(list);
  res.json(record);
});

app.use((req, res) => {
  const index = path.join(__dirname, 'public', 'index.html');
  if(fs.existsSync(index)) return res.sendFile(index);
  res.status(404).send('Not found');
});

app.listen(PORT, '0.0.0.0', () => {
  console.log('Server is running on http://0.0.0.0:' + PORT);
});