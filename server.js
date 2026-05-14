'use strict';

require('dotenv').config();

const express  = require('express');
const multer   = require('multer');
const path     = require('path');
const fs       = require('fs');
const xlsx     = require('xlsx');
const archiver = require('archiver');

const app  = express();
const PORT = process.env.PORT || 3002;

const DATA_FILE  = path.join(__dirname, 'data', 'rsvp.json');
const VIDEOS_DIR = path.join(__dirname, 'data', 'videos');
const PUBLIC_DIR = path.join(__dirname, 'public');
const ADMIN_FILE = path.join(__dirname, 'admin', 'index.html');

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'so2026admin';
const ADMIN_TOKEN    = process.env.ADMIN_TOKEN    || 'so-secret-token-change-me';

[path.join(__dirname,'data'), VIDEOS_DIR].forEach(d => {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
});
if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, JSON.stringify({ rsvps: [] }, null, 2));

const MIME_EXT = {
  'video/webm':'.webm','video/mp4':'.mp4','video/ogg':'.ogg',
  'video/quicktime':'.mov','video/x-matroska':'.mkv','video/3gpp':'.3gp',
};

const storage = multer.diskStorage({
  destination: VIDEOS_DIR,
  filename: (req, file, cb) => {
    const ext = MIME_EXT[(file.mimetype||'').split(';')[0].trim()] || '.webm';
    cb(null, `video_${Date.now()}_${Math.random().toString(36).slice(2,8)}${ext}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 150 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const baseMime = (file.mimetype||'').split(';')[0].trim();
    if (baseMime.startsWith('video/') || baseMime==='application/octet-stream') return cb(null,true);
    if (/\.(webm|mp4|mov|ogg|mkv|3gp|avi)$/i.test(file.originalname)) return cb(null,true);
    cb(new Error('Only video files are allowed'));
  }
});

app.use(express.json());
app.use(express.static(PUBLIC_DIR));

function loadRsvps() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE,'utf8')).rsvps || []; } catch { return []; }
}
function saveRsvps(rsvps) { fs.writeFileSync(DATA_FILE, JSON.stringify({rsvps},null,2)); }
function authAdmin(req, res, next) {
  const token = (req.headers.authorization||'').replace('Bearer ','').trim();
  if (token === ADMIN_TOKEN) return next();
  res.status(401).json({ error: 'Unauthorised' });
}

/* ── PUBLIC API ── */
app.post('/api/video-preupload', upload.single('video'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No video received' });
  console.log('[PRE-UPLOAD]', req.file.filename, req.file.size, 'bytes');
  res.json({ success: true, videoId: req.file.filename });
});

app.post('/api/rsvp', upload.single('video'), (req, res) => {
  const { name, email, attending, videoId } = req.body;
  if (!name || !name.trim()) {
    if (req.file) fs.unlink(req.file.path, ()=>{});
    return res.status(400).json({ error: 'Name is required' });
  }
  let videoFile = req.file?.filename || null;
  if (!videoFile && videoId) {
    const safe = path.basename(videoId);
    if (fs.existsSync(path.join(VIDEOS_DIR, safe))) videoFile = safe;
  }
  const rsvps = loadRsvps();
  const entry = {
    id: Date.now().toString(36)+Math.random().toString(36).slice(2),
    name: name.trim(),
    email: email?.trim()||null,
    attending: attending==='true'||attending===true,
    videoFile,
    submittedAt: new Date().toISOString()
  };
  rsvps.push(entry);
  saveRsvps(rsvps);
  console.log(`[RSVP] ${entry.attending?'ATTENDING':'NOT ATTENDING'} — ${entry.name} — video: ${videoFile||'none'}`);
  res.json({ success: true, id: entry.id });
});

/* ── ADMIN AUTH ── */
app.post('/admin/login', (req, res) => {
  if ((req.body||{}).password === ADMIN_PASSWORD)
    return res.json({ success: true, token: ADMIN_TOKEN });
  res.status(401).json({ error: 'Invalid password' });
});

/* ── ADMIN API ── */
app.get('/admin/api/rsvps', authAdmin, (req, res) => res.json(loadRsvps()));

app.get('/admin/api/video/:filename', authAdmin, (req, res) => {
  const safe = path.basename(req.params.filename);
  const file = path.join(VIDEOS_DIR, safe);
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'Video not found' });
  const rsvp = loadRsvps().find(r => r.videoFile === safe);
  const label = rsvp ? `${rsvp.name.replace(/[^a-z0-9]/gi,'_')}_message.webm` : safe;
  res.setHeader('Content-Disposition', `attachment; filename="${label}"`);
  res.setHeader('Content-Type', 'video/webm');
  fs.createReadStream(file).pipe(res);
});

app.post('/admin/api/download-videos', authAdmin, (req, res) => {
  const { filenames } = req.body;
  if (!Array.isArray(filenames)||!filenames.length) return res.status(400).json({error:'No filenames'});
  const rsvps = loadRsvps();
  const archive = archiver('zip',{zlib:{level:6}});
  res.setHeader('Content-Disposition','attachment; filename="SalhaOsbert_Selected_Videos.zip"');
  res.setHeader('Content-Type','application/zip');
  archive.pipe(res);
  filenames.forEach(fn => {
    const safe = path.basename(fn);
    const file = path.join(VIDEOS_DIR, safe);
    if (!fs.existsSync(file)) return;
    const rsvp = rsvps.find(r => r.videoFile===safe);
    const label = rsvp ? `${rsvp.name.replace(/[^a-z0-9]/gi,'_')}_message.webm` : safe;
    archive.file(file,{name:label});
  });
  archive.finalize();
  archive.on('error', err => console.error('[ZIP]',err));
});

app.get('/admin/api/download-all-videos', authAdmin, (req, res) => {
  const rsvps = loadRsvps().filter(r=>r.videoFile);
  const archive = archiver('zip',{zlib:{level:6}});
  res.setHeader('Content-Disposition','attachment; filename="SalhaOsbert_All_Videos.zip"');
  res.setHeader('Content-Type','application/zip');
  archive.pipe(res);
  rsvps.forEach(r => {
    const file = path.join(VIDEOS_DIR, r.videoFile);
    if (!fs.existsSync(file)) return;
    archive.file(file,{name:`${r.name.replace(/[^a-z0-9]/gi,'_')}_message.webm`});
  });
  archive.finalize();
  archive.on('error', err => console.error('[ZIP]',err));
});

app.delete('/admin/api/rsvp/:id', authAdmin, (req, res) => {
  const rsvps = loadRsvps();
  const idx = rsvps.findIndex(r=>r.id===req.params.id);
  if (idx===-1) return res.status(404).json({error:'Not found'});
  const entry = rsvps[idx];
  if (entry.videoFile) {
    const vp = path.join(VIDEOS_DIR, entry.videoFile);
    if (fs.existsSync(vp)) fs.unlink(vp, err => err && console.warn('[DELETE] unlink:',err.message));
  }
  rsvps.splice(idx,1);
  saveRsvps(rsvps);
  console.log(`[DELETE] ${entry.name} (${entry.id})`);
  res.json({success:true});
});

app.get('/admin/api/export', authAdmin, (req, res) => {
  const rsvps = loadRsvps();
  const fmt = iso => new Date(iso).toLocaleString('en-GB',{dateStyle:'medium',timeStyle:'short'});
  const attending = rsvps.filter(r=>r.attending);
  const declining = rsvps.filter(r=>!r.attending);
  const wb = xlsx.utils.book_new();

  const attRows = attending.map((r,i)=>({'#':i+1,'Full Name':r.name,'Email':r.email||'—','RSVP Date':fmt(r.submittedAt)}));
  const attSheet = xlsx.utils.json_to_sheet(attRows.length?attRows:[{'#':'','Full Name':'No attendees yet','Email':'','RSVP Date':''}]);
  attSheet['!cols']=[{wch:4},{wch:30},{wch:36},{wch:22}];
  xlsx.utils.book_append_sheet(wb,attSheet,'Attendees');

  const decRows = declining.map((r,i)=>({'#':i+1,'Full Name':r.name,'Video Message':r.videoFile?'Yes':'No','RSVP Date':fmt(r.submittedAt)}));
  const decSheet = xlsx.utils.json_to_sheet(decRows.length?decRows:[{'#':'','Full Name':'None yet','Video Message':'','RSVP Date':''}]);
  decSheet['!cols']=[{wch:4},{wch:30},{wch:16},{wch:22}];
  xlsx.utils.book_append_sheet(wb,decSheet,'Not Attending');

  const buf = xlsx.write(wb,{type:'buffer',bookType:'xlsx'});
  res.setHeader('Content-Disposition','attachment; filename="SalhaOsbert_RSVP_Report.xlsx"');
  res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buf);
});

app.get('/admin', (req, res) => res.sendFile(ADMIN_FILE));
app.get('/admin/', (req, res) => res.sendFile(ADMIN_FILE));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('[ERROR]', err.message||err);
  if (err.code==='LIMIT_FILE_SIZE') return res.status(413).json({error:'Video too large (max 150 MB).'});
  if (err.message==='Only video files are allowed') return res.status(415).json({error:'Only video files accepted.'});
  res.status(err.status||500).json({error:err.message||'Internal server error'});
});

app.use((req, res) => res.status(404).json({error:'Not found'}));

app.listen(PORT, () => {
  console.log('');
  console.log('  ╔═══════════════════════════════════════════╗');
  console.log('  ║  Salha & Osbert — Wedding RSVP Server    ║');
  console.log(`  ║  http://localhost:${PORT}                     ║`);
  console.log(`  ║  Admin: http://localhost:${PORT}/admin        ║`);
  console.log('  ╚═══════════════════════════════════════════╝');
  console.log(`  Admin password: ${ADMIN_PASSWORD}`);
  console.log('');
});
