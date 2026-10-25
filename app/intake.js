// "שאלונים" tab: send clients a personal form link, receive encrypted submissions,
// review them in the full coach view and import them into the client's file.
//
// Trust model: the server (Supabase) only ever holds ciphertext. The coach's private key is
// created here, stored non-extractable in IndexedDB, and backed up wrapped with her passphrase.
import * as C from './shared/crypto.js';
import { SECTIONS, BY_ID, normalizeAnswers, LIMITS } from './shared/template.js';
import { buildPrefill, prefillMonth, applyAnswers, compare, insights, summaryText } from './intake-core.js';
import { keystore } from './keystore.js';
import { bookFromMonths, normalizeBook, mergeBooks, booksEqual, TRACK_IDS } from './shared/portal-core.js';

const BOOK_CTX = 'cf-portal-book';
const portalBase = () => cfg.portalUrl || String(cfg.formUrl || '').replace(/form\/?$/, 'portal/');

const cf = window.__cf;
const cfg = window.CASHFLOW_CONFIG || {};
const esc = cf.esc, fmt = cf.fmt;
const MIN_PASS = 12;
const POLL_MS = 60000;
const BACKUP_EVERY_MS = 20 * 3600 * 1000;

const st = {
  portals: [], sendFor: null,
  phase: 'init',          // noconfig | login | mfa-enroll | mfa-verify | denied | key-create | key-unlock | ready | error
  user: null, keys: [],   // keys: [{kid, publicRaw, privateKey}] newest first
  serverKeys: [],
  enroll: null,           // {factorId, qr, secret}
  links: [], subs: [], dec: {},  // dec[subId] = {answers, submittedAt} | {error}
  linkMeta: {},           // linkId -> {clientName, clientRef}
  backups: [],
  open: null,             // submission id shown in the detail view
  created: null,          // {url, clientName} just created
  msg: '', err: '', busy: '',
  showImported: false, showBackups: false, restoreArm: null, lockArm: false,
  notes: {}
};

let sb = null;
let pollTimer = null;

/* ---------- helpers ---------- */
const q = async p => { const { data, error } = await p; if (error) throw error; return data; };
const errText = e => {
  const m = String((e && (e.message || e.code)) || e || '');
  if (/invalid login credentials/i.test(m)) return 'האימייל או הסיסמה שגויים.';
  if (/invalid totp|invalid code|challenge.*expired|mfa_verification_failed/i.test(m)) return 'הקוד שגוי או שפג תוקפו. נסי שוב עם הקוד שמופיע עכשיו באפליקציה.';
  if (/wrong-passphrase/.test(m)) return 'סיסמת המפתח שגויה.';
  if (/failed to fetch|network/i.test(m)) return 'אין חיבור לשרת. בדקי את החיבור לאינטרנט.';
  if (/jwt|session|refresh token/i.test(m)) return 'החיבור פג. צריך להתחבר שוב.';
  return 'משהו השתבש: ' + m;
};
const dateTxt = s => { const d = new Date(s); return d.toLocaleDateString('he-IL') + ' ' + d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' }); };
const clients = () => cf.getWs().clients;
const clientById = id => clients().find(c => c.id === id) || null;
const isOpen = () => cf.cl().view === 'intake';
function rerender() { if (isOpen()) cf.render(); else refreshBadge(); }
function refreshBadge() { const t = document.querySelector('#nav [data-v="intake"]'); if (t) t.innerHTML = 'שאלונים' + badge(); }
async function busy(label, fn) {
  if (st.busy) return;
  st.busy = label; st.err = ''; rerender();
  try { await fn(); } catch (e) { st.err = errText(e); } finally { st.busy = ''; rerender(); }
}
function download(filename, text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  a.download = filename; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

/* ---------- auth & keys ---------- */
async function boot() {
  if (!cfg.supabaseUrl || !cfg.supabaseKey || !window.supabase) { st.phase = 'noconfig'; return rerender(); }
  sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'cf-coach-auth' }
  });
  sb.auth.onAuthStateChange(ev => { if (ev === 'SIGNED_OUT') { st.phase = 'login'; st.user = null; st.keys = []; stopPoll(); rerender(); } });
  await advance();
}

// Walk the session forward to the furthest phase it can reach.
async function advance() {
  try {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) { st.phase = 'login'; return rerender(); }
    const aal = await q(sb.auth.mfa.getAuthenticatorAssuranceLevel());
    st.user = session.user;
    if (aal.currentLevel !== 'aal2') {
      st.phase = aal.nextLevel === 'aal2' ? 'mfa-verify' : 'mfa-enroll';
      if (st.phase === 'mfa-enroll' && !st.enroll) await startEnroll();
      return rerender();
    }
    if (!(await q(sb.rpc('claim_coach')))) { st.phase = 'denied'; return rerender(); }
    st.serverKeys = await q(sb.from('coach_keys').select('kid,public_raw,wrapped_private,created_at').order('created_at', { ascending: false }));
    const local = await keystore.list(st.user.id);
    st.keys = st.serverKeys.map(k => local.find(l => l.kid === k.kid)).filter(Boolean)
      .map(l => ({ kid: l.kid, publicRaw: l.publicRaw, privateKey: l.privateKey }));
    if (!st.serverKeys.length) { st.phase = 'key-create'; return rerender(); }
    if (!st.keys.length || st.keys[0].kid !== st.serverKeys[0].kid) { st.phase = 'key-unlock'; return rerender(); }
    st.phase = 'ready';
    rerender();
    await refresh();
    startPoll();
    sb.rpc('purge_expired').then(() => {}, () => {});
    autoBackup();
  } catch (e) {
    st.err = errText(e);
    if (/jwt|session|refresh/i.test(String(e && e.message))) { await sb.auth.signOut().catch(() => {}); st.phase = 'login'; }
    else if (st.phase === 'init') st.phase = 'error';
    rerender();
  }
}

async function startEnroll() {
  const f = await q(sb.auth.mfa.listFactors());
  for (const x of (f.all || []).filter(x => x.status !== 'verified')) await sb.auth.mfa.unenroll({ factorId: x.id });
  const e = await q(sb.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'ניהול תזרים ' + new Date().toISOString().slice(0, 16), issuer: 'ניהול תזרים' }));
  st.enroll = { factorId: e.id, qr: e.totp.qr_code, secret: e.totp.secret };
}

async function verifyCode(code) {
  let factorId = st.enroll && st.enroll.factorId;
  if (st.phase === 'mfa-verify') { const f = await q(sb.auth.mfa.listFactors()); factorId = (f.totp[0] || {}).id; }
  if (!factorId) throw new Error('no factor');
  await q(sb.auth.mfa.challengeAndVerify({ factorId, code }));
  st.enroll = null;
  await advance();
}

async function createKey(pass) {
  const kp = await C.generateKeyPair();
  const wrapped = await C.wrapPrivateKey(kp.privateKey, pass, kp.kid);
  const privateKey = await C.unwrapPrivateKey(wrapped, pass); // proves the wrap works; non-extractable copy
  await q(sb.from('coach_keys').insert({ kid: kp.kid, public_raw: kp.publicRaw, wrapped_private: wrapped }));
  await keystore.put(st.user.id, { kid: kp.kid, publicRaw: kp.publicRaw, privateKey });
  recoveryFile({ kid: kp.kid, public_raw: kp.publicRaw, wrapped_private: wrapped });
  st.msg = 'המפתח נוצר. קובץ השחזור ירד למחשב: שמרי אותו במקום בטוח (למשל מנהל סיסמאות או Google Drive).';
  await advance();
}

async function unlockKeys(pass, extra) {
  const list = extra ? [extra].concat(st.serverKeys) : st.serverKeys;
  let ok = 0;
  for (const k of list) {
    try {
      const privateKey = await C.unwrapPrivateKey(k.wrapped_private, pass);
      await keystore.put(st.user.id, { kid: k.kid, publicRaw: k.public_raw, privateKey });
      ok++;
    } catch (e) { if (!ok && k === list[0]) throw e; }
  }
  st.msg = 'המפתח נפתח במכשיר הזה.';
  await advance();
}

function recoveryFile(k) {
  download('מפתח-שחזור-ניהול-תזרים-' + k.kid.slice(0, 6) + '.json', JSON.stringify({
    type: 'cashflow-coach-key', note: 'קובץ שחזור למפתח ההצפנה. מוגן בסיסמת המפתח שלך. בלי הסיסמה אי אפשר להשתמש בו.',
    kid: k.kid, public_raw: k.public_raw, wrapped_private: k.wrapped_private
  }, null, 2));
}

/* ---------- data ---------- */
function startPoll() {
  stopPoll();
  pollTimer = setInterval(() => { if (document.visibilityState === 'visible') refresh().catch(() => {}); }, POLL_MS);
}
function stopPoll() { if (pollTimer) clearInterval(pollTimer); pollTimer = null; }
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && st.phase === 'ready') refresh().catch(() => {}); });

const keyFor = kid => st.keys.find(k => k.kid === kid);

async function refresh() {
  const [links, subs, portals] = await Promise.all([
    q(sb.from('form_links').select('id,client_ref,kid,meta,created_at,expires_at,opened_at,last_submitted_at,revoked_at,submit_count,max_submissions').order('created_at', { ascending: false }).limit(300)),
    q(sb.from('submissions').select('id,link_id,envelope,created_at,imported_at').order('created_at', { ascending: false }).limit(300)),
    q(sb.from('portals').select('id,client_ref,key_box,book,version,updated_by,updated_at,client_seen_at,revoked_at,created_at').order('created_at', { ascending: false }).limit(500))
  ]);
  st.links = links; st.subs = subs;
  if (await syncPortals(portals) && !isOpen() && !typingInMain()) cf.render();
  for (const l of links) {
    if (st.linkMeta[l.id] || !l.meta) continue;
    const k = keyFor(l.meta.kid);
    try { st.linkMeta[l.id] = k ? await C.open(l.meta, k.privateKey, k.publicRaw) : {}; } catch (_) { st.linkMeta[l.id] = {}; }
  }
  for (const s of subs) {
    if (st.dec[s.id]) continue;
    const k = keyFor(s.envelope && s.envelope.kid);
    if (!k) { st.dec[s.id] = { error: 'אין במכשיר הזה מפתח שמתאים לטופס הזה.' }; continue; }
    try {
      const raw = await C.open(s.envelope, k.privateKey, k.publicRaw);
      st.dec[s.id] = { answers: normalizeAnswers(raw), submittedAt: typeof raw.submittedAt === 'string' ? raw.submittedAt : s.created_at };
    } catch (_) { st.dec[s.id] = { error: 'לא ניתן לפענח את הטופס (ייתכן שהוא פגום).' }; }
  }
  rerender();
}

const linkOf = s => st.links.find(l => l.id === s.link_id) || null;
function clientOfSub(s) {
  const l = linkOf(s), meta = l ? st.linkMeta[l.id] || {} : {};
  const ref = l ? l.client_ref : null;
  return { client: ref ? clientById(ref) : null, name: meta.clientName || (st.dec[s.id] && st.dec[s.id].answers && st.dec[s.id].answers.name) || '' };
}
const pending = () => st.subs.filter(s => !s.imported_at);

function linkStatus(l) {
  if (l.revoked_at) return ['בוטל', 'st-none'];
  if (l.submit_count > 0) return [l.submit_count > 1 ? `הוגש ×${l.submit_count}` : 'הוגש', 'st-ok'];
  if (new Date(l.expires_at) < new Date()) return ['פג תוקף', 'st-none'];
  if (l.opened_at) return ['נפתח, טרם הוגש', 'st-over'];
  return ['נשלח', 'st-none'];
}

async function createLink(clientId, withPrefill, days, silent) {
  const c = clientById(clientId); if (!c) throw new Error('client');
  const key = st.keys[0];
  const token = C.randomToken(16), hash = await C.sha256Hex(token);
  const prefillKey = withPrefill ? C.newSymKey() : null;
  const prefill = withPrefill ? await C.sealSym(prefillKey, buildPrefill(c, prefillMonth(c)), 'prefill|' + hash) : null;
  const meta = await C.seal(key.publicRaw, { clientName: c.name, clientRef: c.id });
  const expires = new Date(Date.now() + days * 86400000).toISOString();
  const row = await q(sb.from('form_links').insert({ client_ref: c.id, kid: key.kid, token_hash: hash, meta, prefill, expires_at: expires }).select('id').single());
  const url = C.buildFormLink(cfg.formUrl, { token, publicRaw: key.publicRaw, prefillKey });
  // The link (with its token) is kept only on this device, inside the client's file, so it can be copied again.
  c.formLinks = (c.formLinks || []).concat({ id: row.id, url, createdAt: new Date().toISOString(), expiresAt: expires }).slice(-20);
  cf.persist();
  st.linkMeta[row.id] = { clientName: c.name, clientRef: c.id };
  if (silent) return url;
  st.created = { url, clientName: c.name, linkId: row.id };
  await refresh();
  return url;
}

/* ---------- client portal: the client's own monthly report ---------- */
const typingInMain = () => { const a = document.activeElement; return !!(a && /INPUT|TEXTAREA|SELECT/.test(a.tagName) && a.closest('#main')); };
const localBook = c => bookFromMonths(c.months, { clientName: c.name, ...((c.portal && c.portal.meta) || {}) });
const portalRow = c => (c && c.portal ? st.portals.find(p => p.id === c.portal.id && !p.revoked_at) : null) || null;

// Write a merged book back into the coach's months, keeping coach-only fields of each row.
function applyBook(c, book, base) {
  const baseIds = new Set(((base && base.months) || []).map(m => m.id)), bookIds = new Set(book.months.map(m => m.id));
  c.months = c.months.filter(m => m.locked || bookIds.has(m.id) || !baseIds.has(m.id));
  book.months.forEach(bm => {
    let m = c.months.find(x => x.id === bm.id);
    if (!m) { m = cf.newMonth(bm.label); m.id = bm.id; c.months.push(m); }
    m.label = bm.label;
    m.income = bm.income.map(it => ({ ...((m.income || []).find(x => x.id === it.id) || {}), ...it }));
    TRACK_IDS.forEach(id => { const old = m.cats[id] || []; m.cats[id] = bm.cats[id].map(it => ({ ...(old.find(x => x.id === it.id) || {}), ...it })); });
  });
  if (!c.months.length) c.months.push(cf.newMonth('חודש 1'));
  if (!c.months.some(m => m.id === c.monthId)) c.monthId = c.months[0].id;
}

async function syncPortals(rows) {
  st.portals = rows;
  let applied = false, touched = false;
  for (const row of rows) {
    if (row.revoked_at) continue;
    const c = clientById(row.client_ref); if (!c) continue;
    if (!c.portal || c.portal.id !== row.id) {
      if (c.portal && c.portal.id !== row.id && rows.some(r => r.id === c.portal.id && !r.revoked_at)) continue;
      const k = keyFor(row.key_box && row.key_box.kid); if (!k) continue;
      try { const box = await C.open(row.key_box, k.privateKey, k.publicRaw); c.portal = { id: row.id, url: box.url, key: box.k, base: null, version: -1, meta: {} }; touched = true; }
      catch (_) { continue; }
    }
    const P = c.portal, local = localBook(c);
    if (row.version === P.version && booksEqual(local, P.base)) continue;
    let remote;
    try { remote = row.version === P.version ? P.base : normalizeBook(await C.openSym(P.key, row.book, BOOK_CTX)); } catch (_) { continue; }
    const merged = mergeBooks(P.base, local, remote, 'coach');
    if (!booksEqual(merged, local)) {
      if (typingInMain() && !isOpen()) continue;      // never pull the rug while she is typing; next round
      applyBook(c, JSON.parse(JSON.stringify(merged)), P.base); applied = true;   // coach rows must not share objects with the base
    }
    if (!booksEqual(merged, remote)) {
      const done = await q(sb.from('portals').update({ book: await C.sealSym(P.key, merged, BOOK_CTX), version: row.version + 1, updated_by: 'coach', updated_at: new Date().toISOString() })
        .eq('id', row.id).eq('version', row.version).select('version'));
      if (done.length) { P.base = merged; P.version = row.version + 1; row.version = P.version; row.updated_by = 'coach'; }
    } else { P.base = merged; P.version = row.version; }
    P.meta = { templateUrl: merged.templateUrl, templateDone: merged.templateDone };
    touched = true;
  }
  if (touched || applied) cf.persist();
  return applied;
}

async function createPortal(clientId, withTemplate) {
  const c = clientById(clientId); if (!c) throw new Error('client');
  const key = st.keys[0];
  const token = C.randomToken(16), hash = await C.sha256Hex(token), K = C.newSymKey();
  const url = portalBase() + '#' + new URLSearchParams({ t: token, s: K }).toString();
  const meta = { templateUrl: withTemplate ? await createLink(c.id, true, 30, true) : '', templateDone: false };
  const book = bookFromMonths(c.months, { clientName: c.name, ...meta });
  const row = await q(sb.from('portals').insert({
    client_ref: c.id, token_hash: hash, version: 0, updated_by: 'coach',
    key_box: await C.seal(key.publicRaw, { k: K, url, clientRef: c.id, clientName: c.name }),
    book: await C.sealSym(K, book, BOOK_CTX)
  }).select('id').single());
  c.portal = { id: row.id, url, key: K, base: JSON.parse(JSON.stringify(book)), version: 0, meta };
  cf.persist();
  st.created = { url, clientName: c.name, portal: true, withTemplate };
  await refresh();
}

async function portalTemplate(clientId) {
  const c = clientById(clientId); if (!c || !c.portal) return;
  c.portal.meta = { templateUrl: await createLink(c.id, true, 30, true), templateDone: false };
  cf.persist();
  st.msg = 'התבנית צורפה לדוח של ' + c.name + '. היא תופיע אצלו/ה בראש הדוח החודשי.';
  await refresh();
}

async function revokePortal(clientId) {
  const c = clientById(clientId); if (!c || !c.portal) return;
  await q(sb.from('portals').update({ revoked_at: new Date().toISOString() }).eq('id', c.portal.id));
  c.portal = null; cf.persist();
  st.msg = 'הגישה של ' + c.name + ' לדוח החודשי הופסקה. הנתונים נשארים בתיק.';
  st.created = null;
  await refresh();
}

async function revokeLink(id) {
  await q(sb.from('form_links').update({ revoked_at: new Date().toISOString() }).eq('id', id));
  await refresh();
}

async function importSub(subId, opts) {
  const s = st.subs.find(x => x.id === subId), d = st.dec[subId];
  if (!s || !d || !d.answers) return;
  let { client } = clientOfSub(s);
  if (opts.clientId === '__new') client = cf.addClient(opts.newName || d.answers.name || 'לקוח/ה חדש/ה');
  else if (opts.clientId) client = clientById(opts.clientId);
  if (!client) throw new Error('בחרי לקוח לקליטה');
  let month;
  if (opts.target === '__new') {
    const base = prefillMonth(client);
    month = cf.newMonth(opts.monthName || ('טופס לקוח – ' + new Date(d.submittedAt).toLocaleDateString('he-IL')), base, false);
    client.months.push(month);
  } else {
    month = client.months.find(m => m.id === opts.target);
    if (!month || month.locked) throw new Error('החודש שנבחר לא זמין לעריכה');
  }
  const r = applyAnswers(month, d.answers, { column: opts.column, mode: opts.target === '__new' ? 'replace' : opts.mode, mkItem: cf.mkItem, uid: cf.uid });
  // Keep the client's answers in the file itself: after 30 days the server copy is deleted.
  if (client.portal) client.portal.meta = { ...(client.portal.meta || {}), templateDone: true };
  client.forms = (client.forms || []).filter(f => f.subId !== subId).concat({ subId, receivedAt: d.submittedAt, importedAt: new Date().toISOString(), answers: d.answers, note: st.notes[subId] || '' });
  cf.persist();
  await q(sb.from('submissions').update({ imported_at: new Date().toISOString() }).eq('id', subId));
  st.msg = `הטופס נקלט לתיק של ${client.name}, בחודש ״${month.label}״: ${r.written} סכומים נכתבו` + (r.added ? `, ${r.added} סעיפים נוספו` : '') + (r.skipped ? `, ${r.skipped} סעיפים שכבר היו מלאים נשארו כמו שהם` : '') + '.';
  st.open = null;
  await refresh();
  backupNow(true).catch(() => {});
  cf.selectClient(client.id);
  client.monthId = month.id; client.view = 'month'; cf.persist(); cf.render(); window.scrollTo(0, 0);
}

/* ---------- encrypted cloud backup ---------- */
async function loadBackups() { st.backups = await q(sb.from('backups').select('id,created_at,bytes,kid').order('created_at', { ascending: false })); }
async function backupNow(silent) {
  const key = st.keys[0]; if (!key) return;
  const env = await C.seal(key.publicRaw, { type: 'cashflow-workspace', savedAt: new Date().toISOString(), ws: JSON.parse(cf.workspaceJson()) });
  await q(sb.from('backups').insert({ kid: key.kid, envelope: env }));
  await loadBackups();
  if (!silent) st.msg = 'גיבוי מוצפן נשמר בענן ✓';
  rerender();
}
async function autoBackup() {
  try { await loadBackups(); const last = st.backups[0]; if (!last || Date.now() - new Date(last.created_at).getTime() > BACKUP_EVERY_MS) await backupNow(true); rerender(); } catch (_) {}
}
async function restoreBackup(id) {
  const row = await q(sb.from('backups').select('envelope').eq('id', id).single());
  const k = keyFor(row.envelope.kid); if (!k) throw new Error('אין מפתח מתאים לגיבוי הזה');
  const data = await C.open(row.envelope, k.privateKey, k.publicRaw);
  if (!data || data.type !== 'cashflow-workspace' || !cf.validWs(data.ws)) throw new Error('הגיבוי לא תקין');
  cf.setWs(data.ws);
  st.restoreArm = null;
  st.msg = 'הנתונים שוחזרו מהגיבוי של ' + dateTxt(row.envelope && data.savedAt) + '. הגרסה הקודמת נשמרה בגרסאות השמורות (לקוחות וגיבוי).';
}

/* ---------- views ---------- */
export function badge() { const n = st.phase === 'ready' ? pending().length : 0; return n ? ` <span class="ibadge" aria-label="${n} טפסים חדשים">${n}</span>` : ''; }

function msgs() {
  return (st.msg ? `<div class="ok-box" role="status">${esc(st.msg)} <button class="xbtn sm" data-ia="dismiss" aria-label="סגירה">×</button></div>` : '')
    + (st.err ? `<div class="warn-box" role="alert">${esc(st.err)} <button class="xbtn sm" data-ia="dismiss" aria-label="סגירה">×</button></div>` : '');
}
const card = (title, body, cls = '') => `<section class="card ${cls}" style="margin-bottom:14px"><h2>${title}</h2><div class="pad">${body}</div></section>`;
const btn = (ia, label, extra = '', cls = 'btn') => `<button class="${cls}" data-ia="${ia}" ${extra} ${st.busy ? 'disabled' : ''}>${st.busy && st.busy === ia ? 'רגע…' : label}</button>`;

// First-time setup is three steps; show where she is and what unlocks at the end.
const SETUP_STEPS = [['login', 'כניסה'], ['mfa', 'אימות דו־שלבי'], ['key', 'מפתח הצפנה']];
function stepper() {
  const at = { login: 0, 'mfa-enroll': 1, 'mfa-verify': 1, 'key-create': 2, 'key-unlock': 2 }[st.phase];
  if (at === undefined) return '';
  return `<div class="card" style="margin-bottom:14px"><div class="pad">
    <ol class="isteps">${SETUP_STEPS.map(([, l], i) => `<li class="${i < at ? 'done' : i === at ? 'cur' : ''}">${i < at ? '✓' : i + 1}. ${l}</li>`).join('')}<li>✉ שליחת טפסים ללקוחות</li></ol>
    <p class="small" style="margin:8px 0 0">אחרי השלבים האלה יופיעו כאן: <b>שליחת טופס ללקוח</b> (יצירת קישור אישי ושליחה בוואטסאפ), <b>טפסים שהתקבלו</b>, <b>קישורים שנשלחו</b> ו<b>גיבוי</b>.${st.phase === 'login' || st.phase === 'mfa-verify' || st.phase === 'key-unlock' ? ' בכניסות הבאות מספיקים סיסמה וקוד מהאפליקציה.' : ''}</p>
  </div></div>`;
}

function setupView() {
  return stepper() + setupCard();
}

function setupCard() {
  switch (st.phase) {
    case 'init': return card('שאלונים', '<p class="note-s">מתחבר…</p>');
    case 'error': return card('שאלונים', `<p>לא הצלחתי להתחבר לשרת.</p>${btn('retry', 'לנסות שוב')}`);
    case 'noconfig': return card('חיבור לשרת', `<p>מערכת השאלונים עוד לא חוברה לשרת (Supabase).</p>
      <p class="small">אחרי שיוצרים את הפרויקט ב־Supabase, מכניסים את כתובת הפרויקט ואת המפתח הציבורי לקובץ <code>app/config.js</code> בריפו הפרטי. ההוראות המלאות: <code>docs/SETUP.md</code>.</p>`);
    case 'login': return card('כניסה למערכת השאלונים', `
      <p class="small">כניסה עם המשתמש שיצרת ב־Supabase. אחרי הסיסמה מבקשים קוד מאפליקציית האימות.</p>
      <form class="iform" data-iform="login" autocomplete="on">
        <label>אימייל <input type="email" name="email" autocomplete="username" required></label>
        <label>סיסמה <input type="password" name="password" autocomplete="current-password" required></label>
        <button class="btn" ${st.busy ? 'disabled' : ''}>${st.busy ? 'רגע…' : 'כניסה'}</button>
      </form>`);
    case 'mfa-enroll': return card('הגדרת אימות דו־שלבי (פעם אחת)', `
      <ol class="steps">
        <li>מתקינים בטלפון אפליקציית אימות: Google Authenticator או Microsoft Authenticator.</li>
        <li>באפליקציה בוחרים ״הוספת חשבון״ וסורקים את הקוד:</li>
      </ol>
      ${st.enroll ? `<div class="qr"><img src="${esc(st.enroll.qr)}" alt="קוד QR להגדרת אפליקציית האימות" width="200" height="200"></div>
      <p class="small">לא מצליחה לסרוק? מקלידים באפליקציה את הקוד: <code dir="ltr">${esc(st.enroll.secret)}</code></p>` : '<p class="note-s">טוען…</p>'}
      <form class="iform" data-iform="totp"><label>הקוד בן 6 הספרות מהאפליקציה <input name="code" inputmode="numeric" autocomplete="one-time-code" pattern="\\d{6}" maxlength="6" required dir="ltr"></label>
      <button class="btn" ${st.busy ? 'disabled' : ''}>${st.busy ? 'רגע…' : 'אישור'}</button></form>
      <p><button class="btn ghost" data-ia="signout">יציאה</button></p>`);
    case 'mfa-verify': return card('אימות דו־שלבי', `
      <form class="iform" data-iform="totp"><label>הקוד בן 6 הספרות מאפליקציית האימות <input name="code" inputmode="numeric" autocomplete="one-time-code" pattern="\\d{6}" maxlength="6" required dir="ltr" autofocus></label>
      <button class="btn" ${st.busy ? 'disabled' : ''}>${st.busy ? 'רגע…' : 'אישור'}</button></form>
      <p><button class="btn ghost" data-ia="signout">יציאה</button></p>`);
    case 'denied': return card('אין הרשאה', `<p>המשתמש הזה לא מורשה במערכת השאלונים. רק המשתמש הראשון שהתחבר הוא המאמנת.</p>${btn('signout', 'יציאה', '', 'btn ghost')}`);
    case 'key-create': return card('יצירת מפתח הצפנה (פעם אחת)', `
      <p>הטפסים של הלקוחות מוצפנים במפתח שנוצר עכשיו במחשב שלך. רק המפתח הזה יכול לפתוח אותם, וגם השרת לא יכול.</p>
      <p>בוחרים <b>סיסמת מפתח</b>, לפחות ${MIN_PASS} תווים. היא נדרשת כדי לפתוח את המפתח במכשיר חדש. <b>אם הסיסמה תאבד, לא יהיה אפשר לפתוח טפסים ישנים.</b> מומלץ לשמור אותה במנהל סיסמאות.</p>
      <form class="iform" data-iform="keycreate">
        <label>סיסמת מפתח <input type="password" name="p1" minlength="${MIN_PASS}" autocomplete="new-password" required></label>
        <label>שוב, לאימות <input type="password" name="p2" minlength="${MIN_PASS}" autocomplete="new-password" required></label>
        <button class="btn" ${st.busy ? 'disabled' : ''}>${st.busy ? 'יוצר מפתח…' : 'יצירת מפתח'}</button>
      </form>`);
    case 'key-unlock': return card('פתיחת מפתח ההצפנה במכשיר הזה', `
      <p>המפתח שלך שמור בשרת כשהוא נעול בסיסמת המפתח. מקלידים את הסיסמה כדי לפתוח אותו במכשיר הזה.</p>
      <form class="iform" data-iform="unlock">
        <label>סיסמת מפתח <input type="password" name="p" autocomplete="current-password" required></label>
        <button class="btn" ${st.busy ? 'disabled' : ''}>${st.busy ? 'פותח…' : 'פתיחה'}</button>
      </form>
      <details class="small"><summary>יש לי קובץ שחזור</summary><p>אפשר לטעון את קובץ השחזור שירד כשהמפתח נוצר, ואז להקליד את הסיסמה.</p>
      <label class="filebtn"><input type="file" accept=".json" data-ifile="recovery">טעינת קובץ שחזור</label>${st.recovery ? '<p class="ok-box">הקובץ נטען. עכשיו מקלידים את הסיסמה למעלה.</p>' : ''}</details>`);
  }
  return '';
}

function sendCard() {
  const cur = clientById(st.sendFor) || cf.cl();
  const opts = clients().map(c => `<option value="${esc(c.id)}" ${c.id === cur.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
  const row = portalRow(cur);
  const first = cur.name.split(' ')[0];
  const share = (url, text, title, idAttr = 'in-url') => `<input readonly class="linkurl" id="${idAttr}" value="${esc(url)}" dir="ltr" aria-label="הקישור">
      <div class="row-btns">
        <a class="btn" href="https://wa.me/?text=${encodeURIComponent(text)}" target="_blank" rel="noopener noreferrer">שליחה בוואטסאפ</a>
        <a class="btn" href="mailto:?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(text)}">שליחה במייל</a>
        <button class="btn ghost" data-ia="copy" data-url="${esc(url)}">העתקה</button>
      </div>`;
  let body;
  if (row && cur.portal) {
    const meta = cur.portal.meta || {};
    const text = `שלום ${first}, זה הקישור האישי והקבוע שלך לדוח התזרים החודשי. כדאי לשמור אותו במועדפים: בו ממלאים כל שבוע את ההוצאות, רואים את החודשים הקודמים ופותחים חודש חדש.${meta.templateUrl && !meta.templateDone ? ' בפעם הראשונה ממלאים בו את התבנית החודשית.' : ''} הדוח מוצפן, ורק את/ה ואני יכולים לקרוא אותו.\n${cur.portal.url}`;
    const seen = row.client_seen_at ? 'נכנס/ה לאחרונה ' + dateTxt(row.client_seen_at) : 'עוד לא נכנס/ה';
    const upd = row.updated_by === 'client' ? ' · עדכן/ה את הדוח ' + dateTxt(row.updated_at) : '';
    body = `<div class="linkbox"><p><b>ל${esc(cur.name)} יש קישור קבוע לדוח החודשי.</b> <span class="small">${esc(seen + upd)}</span></p>
      ${share(cur.portal.url, text, 'הדוח החודשי שלי')}
      <p class="small">מה שהלקוח/ה ממלא/ה מתעדכן אצלך בתיק, בחודשים של מעקב חודשי (עמודת ״שולם״ והשבועות). תקציבים ושמות סעיפים שאת משנה מתעדכנים אצלו/ה.</p>
      <div class="row-btns">${meta.templateUrl && !meta.templateDone ? '<span class="badge st-over">תבנית ראשונית ממתינה למילוי</span>' : btn('portal-tpl', 'צירוף תבנית ראשונית לדוח', `data-id="${esc(cur.id)}"`, 'btn ghost')}
      ${st.revokePortal === cur.id ? `<button class="btn danger" data-ia="portal-revoke-yes" data-id="${esc(cur.id)}">להפסיק את הגישה?</button>` : `<button class="btn ghost" data-ia="portal-revoke" data-id="${esc(cur.id)}">הפסקת הגישה</button>`}</div></div>`;
  } else {
    body = `<p>הלקוח/ה מקבל/ת קישור קבוע אחד, ממנו:</p>
      <ul class="steps"><li>ממלאים פעם אחת את <b>התבנית החודשית</b> (אם מסמנים למטה).</li><li>ממלאים כל שבוע את <b>הדוח החודשי</b>, רואים את החודשים הקודמים ופותחים חודש חדש.</li></ul>
      <p class="small">מה שהלקוח/ה ממלא/ה מגיע מוצפן לתיק שלו/ה אצלך. הלקוח/ה לא רואה את המערכת שלך ולא לקוחות אחרים.</p>
      <label class="chk"><input type="checkbox" id="in-tpl" ${(cur.forms || []).length ? '' : 'checked'}> לצרף את התבנית החודשית למילוי ראשון</label>
      <p>${btn('portal-create', 'יצירת קישור אישי ללקוח/ה', `data-id="${esc(cur.id)}"`)}</p>`;
  }
  return card('קישור אישי ללקוח', `<div class="igrid"><label>לקוח/ה <select id="in-client">${opts}</select></label></div>${body}
    <details class="small" id="in-tplonly" ${st.tplOpen ? 'open' : ''}><summary>שליחת תבנית בלבד, בלי דוח חודשי</summary>
      <div class="igrid"><label>תוקף הקישור <select id="in-days"><option value="7">שבוע</option><option value="14" selected>שבועיים</option><option value="30">חודש</option></select></label></div>
      <label class="chk"><input type="checkbox" id="in-prefill" checked> לצרף לטופס את הסעיפים מהתיק</label>
      <p>${btn('create', 'יצירת קישור לתבנית בלבד')}</p>
      ${st.created && !st.created.portal ? share(st.created.url, `שלום ${st.created.clientName.split(' ')[0]}, זה הקישור האישי שלך לתבנית התזרים החודשית. הטופס מוצפן ורק אני יכולה לקרוא אותו:\n${st.created.url}`, 'התבנית החודשית', 'in-url-tpl') : ''}
    </details>`);
}

function inboxCard() {
  const list = pending();
  if (!list.length) return card('טפסים שהתקבלו', '<p class="note-s">אין טפסים חדשים. כשלקוח ישלח טופס הוא יופיע כאן (בדיקה אוטומטית כל דקה).</p>');
  return card(`טפסים שהתקבלו <span class="ibadge">${list.length}</span>`, `<div class="ilist">${list.map(subRow).join('')}</div>`);
}

function subRow(s) {
  const d = st.dec[s.id] || {}, { client, name } = clientOfSub(s);
  const t = d.answers ? insights(d.answers).totals : null;
  return `<div class="irow">
    <div><b>${esc((client && client.name) || name || 'לקוח לא מזוהה')}</b>${client ? '' : ' <span class="badge st-over">לא משויך לתיק</span>'}<br><span class="small">${esc(dateTxt(d.submittedAt || s.created_at))}${d.answers && d.answers.period ? ' · ' + esc(d.answers.period) : ''}</span></div>
    ${t ? `<div class="small">הכנסות <span class="num">${fmt(t.income)}</span> · הוצאות <span class="num">${fmt(t.expenses)}</span> · הפרש <span class="num ${t.balance < 0 ? 'neg' : 'pos'}">${fmt(t.balance)}</span></div>` : `<div class="small neg">${esc(d.error || 'מפענח…')}</div>`}
    <div>${d.answers ? `<button class="btn" data-ia="open" data-id="${esc(s.id)}">פתיחה</button>` : ''}</div>
  </div>`;
}

function linksCard() {
  const rows = st.links.slice(0, 60).map(l => {
    const meta = st.linkMeta[l.id] || {}, c = clientById(l.client_ref), [label, cls] = linkStatus(l);
    const local = c && (c.formLinks || []).find(x => x.id === l.id);
    const live = !l.revoked_at && new Date(l.expires_at) > new Date() && l.submit_count < l.max_submissions;
    return `<tr><td>${esc((c && c.name) || meta.clientName || '—')}</td><td>${esc(new Date(l.created_at).toLocaleDateString('he-IL'))}</td><td>${esc(new Date(l.expires_at).toLocaleDateString('he-IL'))}</td>
      <td><span class="badge ${cls}">${label}</span></td>
      <td class="a">${live && local ? `<button class="btn ghost sm" data-ia="copy" data-url="${esc(local.url)}">העתקה</button>` : ''}${live ? (st.revokeArm === l.id ? `<button class="btn danger sm" data-ia="revoke-yes" data-id="${esc(l.id)}">לבטל?</button>` : `<button class="btn ghost sm" data-ia="revoke" data-id="${esc(l.id)}">ביטול</button>`) : ''}</td></tr>`;
  }).join('');
  return card('קישורים שנשלחו', rows ? `<div class="scroll"><table class="lst"><thead><tr><th>לקוח/ה</th><th>נשלח</th><th>בתוקף עד</th><th>מצב</th><th class="a"></th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p class="note-s">עוד לא נשלחו קישורים.</p>');
}

function importedCard() {
  const list = st.subs.filter(s => s.imported_at);
  if (!list.length) return '';
  return card('טפסים שנקלטו', `<p class="small">עותק מוצפן נשאר בשרת 30 יום אחרי הקליטה ואז נמחק. התשובות עצמן נשמרות בתיק הלקוח.</p>
    <button class="btn ghost" data-ia="toggle-imported">${st.showImported ? 'הסתרה' : `הצגה (${list.length})`}</button>
    ${st.showImported ? `<div class="ilist">${list.map(subRow).join('')}</div>` : ''}`);
}

function securityCard() {
  const last = st.backups[0];
  return card('גיבוי ואבטחה', `
    <p>מחוברת כ־<b dir="ltr">${esc(st.user && st.user.email)}</b> · מפתח פעיל <code dir="ltr">${esc(st.keys[0] && st.keys[0].kid.slice(0, 8))}</code></p>
    <p class="small">גיבוי מוצפן של כל הלקוחות נשמר בענן אוטומטית פעם ביום (14 אחרונים). רק המפתח שלך פותח אותו.</p>
    <p>גיבוי אחרון: <b>${last ? esc(dateTxt(last.created_at)) : 'עדיין אין'}</b></p>
    <div class="row-btns">${btn('backup', 'גיבוי עכשיו')}<button class="btn ghost" data-ia="toggle-backups">${st.showBackups ? 'הסתרת גיבויים' : 'שחזור מגיבוי'}</button>
      ${btn('recovery', 'הורדת קובץ שחזור למפתח', '', 'btn ghost')}
      ${st.lockArm ? `<button class="btn danger" data-ia="lock-yes">לנעול? (יידרש שוב הסיסמה)</button>` : `<button class="btn ghost" data-ia="lock">נעילת המפתח במכשיר הזה</button>`}
      <button class="btn ghost" data-ia="signout">יציאה</button></div>
    ${st.showBackups ? `<div class="ilist">${st.backups.map(b => `<div class="irow"><div>${esc(dateTxt(b.created_at))}</div><div class="small num">${Math.round(b.bytes / 1024)} KB</div><div>${st.restoreArm === b.id ? `<button class="btn danger" data-ia="restore-yes" data-id="${esc(b.id)}">כן, לשחזר (מחליף את כל הנתונים במכשיר)</button>` : `<button class="btn ghost" data-ia="restore" data-id="${esc(b.id)}">שחזור</button>`}</div></div>`).join('') || '<p class="note-s">אין גיבויים.</p>'}</div>` : ''}`);
}

function detailView(s) {
  const d = st.dec[s.id], a = d.answers, { client, name } = clientOfSub(s);
  const target = client || clientById(st.pickClient) || null;
  const month = target ? (target.months.find(m => m.id === st.pickMonth) || prefillMonth(target)) : null;
  const ins = insights(a), t = ins.totals, cmp = compare(month, a);
  const pct = r => (Math.round(r * 1000) / 10) + '%';
  const flag = f => `<li class="fl ${f.level}">${esc(f.text)}</li>`;
  // Only lines with an amount (reported or already in the file); empty template lines are noise here.
  const shown = r => r.monthly > 0 || (r.current != null && r.current > 0);
  const secRows = cmp.map(x => ({ ...x, rows: st.showEmpty ? x.rows : x.rows.filter(shown) })).filter(x => x.rows.length).map(x => {
    const s0 = x.section;
    return `<tr class="cat"><td colspan="4"><span class="dot" style="--cat:#${s0.color}"></span>${esc(s0.name)}</td><td><span class="num">${fmt(x.total)}</span></td></tr>` + x.rows.map(r => `<tr class="sub2">
      <td>${esc(r.label || '—')}</td>
      <td>${s0.kind === 'annual' && r.amount ? `<span class="num">${fmt(r.amount)}</span> בשנה` : ''}</td>
      <td>${r.end ? `<span class="num">${esc(r.end)}</span>` : ''}</td>
      <td>${r.current == null ? '<span class="small">שורה חדשה</span>' : `<span class="num">${fmt(r.current)}</span>`}</td>
      <td class="${r.current != null && r.current !== r.monthly ? 'chg' : ''}"><span class="num">${fmt(r.monthly)}</span></td></tr>`).join('');
  }).join('');
  const clientOpts = clients().map(c => `<option value="${esc(c.id)}" ${target && c.id === target.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
  const monthOpts = target ? target.months.filter(m => !m.locked).map(m => `<option value="${esc(m.id)}" ${month && m.id === month.id ? 'selected' : ''}>${esc(m.label)}</option>`).join('') : '';
  return `<section>
    <div class="monthbar"><button class="btn ghost" data-ia="close">→ חזרה לרשימה</button>
      <div class="box"><b>טופס של</b> <span>${esc((client && client.name) || name || 'לקוח לא מזוהה')}</span></div>
      <span class="small">התקבל ${esc(dateTxt(d.submittedAt))}${a.period ? ' · מתייחס ל: ' + esc(a.period) : ''}</span></div>
    <div class="cards4">
      <div class="stat"><small>הכנסות (מדווח)</small><b class="num">${fmt(t.income)}</b></div>
      <div class="stat"><small>הוצאות (מדווח)</small><b class="num">${fmt(t.expenses)}</b></div>
      <div class="stat"><small>הפרש חודשי</small><b class="num ${t.balance < 0 ? 'neg' : 'pos'}">${fmt(t.balance)}</b></div>
      <div class="stat"><small>מגורים / הכנסה</small><b>${t.income ? pct(ins.ratios.housing) : '–'}</b></div>
      <div class="stat"><small>החזרי חובות / הכנסה</small><b>${t.income ? pct(ins.ratios.debt) : '–'}</b></div>
      <div class="stat"><small>קבועות / משתנות</small><b>${t.income ? pct(ins.ratios.fixed) + ' / ' + pct(ins.ratios.variable) : '–'}</b></div>
    </div>
    <div class="analysis">
      <div class="card"><h2>נקודות לבדיקה</h2><div class="pad"><ul class="flags">${ins.flags.map(flag).join('')}</ul>
        ${a.note ? `<p><b>הערת הלקוח/ה:</b></p><p class="cnote">${esc(a.note)}</p>` : ''}
        <label class="nlabel">הערות שלי (נשמרות בתיק עם הטופס)<textarea id="in-note" data-isub="${esc(s.id)}" maxlength="${LIMITS.note * 3}">${esc(st.notes[s.id] || '')}</textarea></label></div></div>
      <div class="card"><h2>קליטה לתיק</h2><div class="pad">
        <div class="igrid">
          <label>לתיק של <select id="in-tclient"><option value="">בחירה…</option>${clientOpts}<option value="__new">+ לקוח חדש${a.name ? ': ' + esc(a.name) : ''}</option></select></label>
          <label>לחודש <select id="in-tmonth" ${target ? '' : 'disabled'}><option value="__new" ${st.pickMonth === '__new' ? 'selected' : ''}>חודש חדש מהטופס</option>${monthOpts}</select></label>
          <label>לעמודה <select id="in-col"><option value="budget">תקציב</option><option value="paid">שולם</option></select></label>
          <label>אם כבר יש סכום <select id="in-mode"><option value="fill">להשאיר את הקיים</option><option value="replace">להחליף בסכום מהטופס</option></select></label>
        </div>
        <p class="small">סעיפים חדשים מתווספים, ושום סעיף לא נמחק. הוצאות שנתיות נכנסות כסכום חודשי (שנתי חלקי 12).</p>
        ${btn('import', 'קליטה לתיק', `data-id="${esc(s.id)}"`)}
        <p class="small" style="margin-top:14px"><b>סיכום מסודר למייל שלך</b> (נבנה כאן במחשב, ונשלח רק כשאת לוחצת ״שליחה״ ב־Gmail):</p>
        <div class="row-btns"><button class="btn ghost" data-ia="mail" data-id="${esc(s.id)}">פתיחה ב־Gmail</button><button class="btn ghost" data-ia="copysum" data-id="${esc(s.id)}">העתקת הסיכום</button></div>
      </div></div>
    </div>
    <div class="card"><h2>מה הלקוח/ה מילא/ה, מול מה שיש בתיק${month ? ` (״${esc(month.label)}״)` : ''}</h2>
      <div class="pad small"><label class="chk"><input type="checkbox" data-ia="toggle-empty" ${st.showEmpty ? 'checked' : ''}> הצגת גם שורות ריקות</label> סכום מסומן = שונה ממה שיש בתיק עכשיו.</div>
      <div class="scroll"><table class="tbl"><thead><tr><th>סעיף</th><th>שנתי</th><th>מסתיים</th><th>בתיק עכשיו</th><th>מהטופס (לחודש)</th></tr></thead><tbody>${secRows || '<tr><td colspan="5">הטופס ריק.</td></tr>'}</tbody></table></div></div>
  </section>`;
}

export function view() {
  if (st.phase !== 'ready') return `<div class="intake">${msgs()}${setupView()}</div>`;
  const s = st.open && st.subs.find(x => x.id === st.open);
  if (s && st.dec[s.id] && st.dec[s.id].answers) return `<div class="intake">${msgs()}${detailView(s)}</div>`;
  return `<div class="intake">${msgs()}${inboxCard()}${sendCard()}${linksCard()}${importedCard()}${securityCard()}</div>`;
}

export function mounted() {
  if (st.phase === 'mfa-verify' || st.phase === 'mfa-enroll') { const i = document.querySelector('[data-iform="totp"] input'); if (i) i.focus(); }
}

/* ---------- events ---------- */
document.addEventListener('submit', e => {
  const f = e.target.closest && e.target.closest('[data-iform]'); if (!f) return;
  e.preventDefault();
  const v = Object.fromEntries(new FormData(f).entries());
  switch (f.dataset.iform) {
    case 'login': busy('login', async () => { await q(sb.auth.signInWithPassword({ email: v.email.trim(), password: v.password })); await advance(); }); break;
    case 'totp': busy('totp', () => verifyCode(String(v.code).trim())); break;
    case 'keycreate':
      if (v.p1 !== v.p2) { st.err = 'שתי הסיסמאות לא זהות.'; return rerender(); }
      if (v.p1.length < MIN_PASS) { st.err = `הסיסמה קצרה מדי (לפחות ${MIN_PASS} תווים).`; return rerender(); }
      busy('keycreate', () => createKey(v.p1)); break;
    case 'unlock': busy('unlock', () => unlockKeys(v.p, st.recovery)); break;
  }
});

document.addEventListener('change', async e => {
  const t = e.target;
  if (t.dataset && t.dataset.ifile === 'recovery') {
    try {
      const k = JSON.parse(await t.files[0].text());
      if (k.type !== 'cashflow-coach-key' || !k.wrapped_private || !k.public_raw) throw new Error('bad');
      st.recovery = { kid: k.kid, public_raw: k.public_raw, wrapped_private: k.wrapped_private };
      if (!st.serverKeys.some(x => x.kid === k.kid)) st.serverKeys = [st.recovery].concat(st.serverKeys);
      st.err = '';
    } catch (_) { st.err = 'זה לא קובץ שחזור תקין.'; }
    return rerender();
  }
  if (t.id === 'in-client') { st.sendFor = t.value; st.created = null; rerender(); return; }
  if (t.id === 'in-tclient') { st.pickClient = t.value; st.pickMonth = null; rerender(); }
  if (t.id === 'in-tmonth') { st.pickMonth = t.value; }
});

document.addEventListener('toggle', e => { if (e.target.id === 'in-tplonly') st.tplOpen = e.target.open; }, true);
document.addEventListener('input', e => { if (e.target.id === 'in-note') { st.notes[e.target.dataset.isub] = e.target.value; } });

document.addEventListener('click', e => {
  const b = e.target.closest ? e.target.closest('[data-ia]') : null; if (!b) return;
  const id = b.dataset.id;
  switch (b.dataset.ia) {
    case 'dismiss': st.msg = ''; st.err = ''; rerender(); break;
    case 'retry': st.phase = 'init'; st.err = ''; rerender(); advance(); break;
    case 'signout': busy('signout', async () => { stopPoll(); await sb.auth.signOut(); st.phase = 'login'; st.user = null; st.keys = []; st.dec = {}; st.linkMeta = {}; }); break;
    case 'portal-create': busy('portal-create', () => createPortal(id, document.getElementById('in-tpl').checked)); break;
    case 'portal-tpl': busy('portal-tpl', () => portalTemplate(id)); break;
    case 'portal-revoke': st.revokePortal = id; rerender(); break;
    case 'portal-revoke-yes': st.revokePortal = null; busy('portal-revoke', () => revokePortal(id)); break;
    case 'create': {
      const cid = document.getElementById('in-client').value, days = +document.getElementById('in-days').value, pre = document.getElementById('in-prefill').checked;
      busy('create', () => createLink(cid, pre, days)); break;
    }
    case 'copy': {
      const url = b.dataset.url;
      navigator.clipboard.writeText(url).then(() => { st.msg = 'הקישור הועתק ✓'; rerender(); }, () => { const i = document.getElementById('in-url'); if (i) { i.select(); } st.msg = 'סמני את הקישור והעתיקי (Ctrl+C)'; rerender(); });
      break;
    }
    case 'revoke': st.revokeArm = id; rerender(); break;
    case 'revoke-yes': st.revokeArm = null; busy('revoke', () => revokeLink(id)); break;
    case 'open': {
      st.open = id; st.msg = '';
      const s = st.subs.find(x => x.id === id), { client } = clientOfSub(s);
      st.pickClient = client ? client.id : ''; st.pickMonth = null;
      rerender(); window.scrollTo(0, 0); break;
    }
    case 'close': st.open = null; rerender(); break;
    case 'import': {
      const clientSel = document.getElementById('in-tclient').value;
      const s = st.subs.find(x => x.id === id), d = st.dec[id];
      const opts = { clientId: clientSel || (clientOfSub(s).client || {}).id, newName: d && d.answers.name,
        target: document.getElementById('in-tmonth').value || '__new', column: document.getElementById('in-col').value, mode: document.getElementById('in-mode').value };
      if (!opts.clientId) { st.err = 'בחרי לאיזה תיק לקלוט את הטופס.'; rerender(); break; }
      busy('import', () => importSub(id, opts)); break;
    }
    case 'mail': case 'copysum': {
      const s = st.subs.find(x => x.id === id), d = st.dec[id]; if (!d || !d.answers) break;
      const { client, name } = clientOfSub(s), who = (client && client.name) || name;
      const body = summaryText(d.answers, { clientName: who, receivedAt: d.submittedAt, note: st.notes[id] || '' });
      const subject = 'טופס תזרים – ' + (who || 'לקוח/ה');
      if (b.dataset.ia === 'mail') {
        const u = 'https://mail.google.com/mail/?view=cm&fs=1&to=' + encodeURIComponent((st.user && st.user.email) || '') + '&su=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body);
        window.open(u, '_blank', 'noopener');
      } else navigator.clipboard.writeText(subject + '\n\n' + body).then(() => { st.msg = 'הסיכום הועתק ✓ אפשר להדביק במייל או בוואטסאפ.'; rerender(); }, () => { st.err = 'לא הצלחתי להעתיק.'; rerender(); });
      break;
    }
    case 'toggle-empty': st.showEmpty = !st.showEmpty; rerender(); break;
    case 'toggle-imported': st.showImported = !st.showImported; rerender(); break;
    case 'toggle-backups': st.showBackups = !st.showBackups; st.restoreArm = null; if (st.showBackups) busy('backups', loadBackups); else rerender(); break;
    case 'backup': busy('backup', () => backupNow(false)); break;
    case 'restore': st.restoreArm = id; rerender(); break;
    case 'restore-yes': busy('restore', () => restoreBackup(id)); break;
    case 'recovery': { const k = st.serverKeys[0]; if (k) recoveryFile(k); break; }
    case 'lock': st.lockArm = true; rerender(); break;
    case 'lock-yes': st.lockArm = false; busy('lock', async () => { await keystore.clear(st.user.id); st.keys = []; stopPoll(); st.dec = {}; st.linkMeta = {}; await advance(); }); break;
  }
});

window.CFIntake = { view, mounted, badge };
boot();
