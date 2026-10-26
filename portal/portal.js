// Client portal: the client's own monthly report. Opened from a permanent personal link:
//   portal/#t=<access token>&s=<book key>
// The book is decrypted and encrypted here, in the browser; the server only stores ciphertext.
import { sealSym, openSym, sha256Hex } from '../shared/crypto.js';
import { SECTIONS, BY_ID } from '../shared/template.js';
import { normalizeBook, mergeBooks, booksEqual, newMonthFrom, nextMonthLabel, newRow, monthTotals, WEEKLY } from '../shared/portal-core.js';

if (window.top !== window.self) { document.documentElement.innerHTML = ''; throw new Error('framed'); }

const CTX = 'cf-portal-book';
const SAVE_DELAY = 1200, POLL_MS = 60000;
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const n0 = v => { const n = parseFloat(String(v == null ? '' : v).replace(/[^\d.]/g, '')); return isFinite(n) ? n : 0; };
const fmt = n => (n < 0 ? '-' : '') + '₪' + Math.abs(Math.round(n)).toLocaleString('he-IL');
const nv = v => (n0(v) ? String(n0(v)) : '');
const clone = x => JSON.parse(JSON.stringify(x));
const app = document.getElementById('app');
const cfg = window.CASHFLOW_CONFIG || {};

const P = { open: new Set(['inc', 'var']), token: '', key: '', base: null, local: null, version: 0, monthId: null, dirty: false, saving: false, status: '', storeKey: '', confirmNew: false };

const REASONS = {
  invalid: 'הקישור לא תקין. כדאי לבקש מהמאמנת את הקישור שלך שוב.',
  revoked: 'הגישה לדוח הזה הופסקה. לפרטים אפשר לפנות למאמנת.',
  config: 'הדוח עדיין לא חובר לשרת. כדאי לפנות למאמנת.',
  network: 'אין חיבור לשרת כרגע. נסו שוב בעוד רגע.',
  key: 'לא הצלחנו לפתוח את הדוח. ודאו שפתחתם את הקישור המלא שקיבלתם.'
};

async function rpc(name, body) {
  const headers = { 'Content-Type': 'application/json', apikey: cfg.supabaseKey };
  if (/^eyJ/.test(cfg.supabaseKey)) headers.Authorization = 'Bearer ' + cfg.supabaseKey;
  let res;
  try { res = await fetch(cfg.supabaseUrl.replace(/\/+$/, '') + '/rest/v1/rpc/' + name, { method: 'POST', headers, body: JSON.stringify(body), credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer' }); }
  catch (_) { throw new Error('network'); }
  if (!res.ok) throw new Error('network');
  return res.json();
}

/* ---------- device copy (so nothing typed is lost offline) ---------- */
function store() { try { localStorage.setItem(P.storeKey, JSON.stringify({ base: P.base, local: P.local, version: P.version, monthId: P.monthId })); } catch (_) {} }
function restore() { try { const d = JSON.parse(localStorage.getItem(P.storeKey) || 'null'); return d && d.local && d.local.months ? d : null; } catch (_) { return null; } }

/* ---------- saving ---------- */
let saveTimer = null;
function changed() {
  P.dirty = true; store(); setStatus('');
  clearTimeout(saveTimer); saveTimer = setTimeout(save, SAVE_DELAY);
}
async function save() {
  clearTimeout(saveTimer); saveTimer = null;
  if (!P.dirty || P.saving) return;
  P.saving = true; setStatus('שומר…');
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      if (!P.dirty) { setStatus('נשמר ✓'); return; }
      const snapshot = clone(P.local);
      const r = await rpc('portal_save', { p_token: P.token, p_book: await sealSym(P.key, snapshot, CTX), p_version: P.version });
      if (r && r.ok) {
        P.base = snapshot; P.version = r.version;
        P.dirty = !booksEqual(P.local, snapshot);   // more typing while saving -> save again
        store(); setStatus(P.dirty ? '' : 'נשמר ✓');
        if (P.dirty) { saveTimer = setTimeout(save, SAVE_DELAY); }
        return;
      }
      if (r && r.reason === 'conflict') { await absorb(r.book, r.version); continue; }
      if (r && r.reason === 'revoked') return fail('revoked');
      throw new Error('network');
    }
  } catch (_) {
    setStatus('אין חיבור. השינויים שמורים במכשיר ויישלחו כשהחיבור יחזור.', true);
    saveTimer = setTimeout(save, 15000);
  } finally { P.saving = false; }
}
// Bring in a newer server version (from the coach) without losing what the client typed.
async function absorb(envelope, version) {
  const remote = normalizeBook(await openSym(P.key, envelope, CTX));
  const before = clone(P.local);
  P.local = P.dirty ? mergeBooks(P.base, P.local, remote, 'client') : clone(remote);
  P.base = remote; P.version = version;   // base and local must never share objects
  P.dirty = !booksEqual(P.local, remote);
  store();
  if (!booksEqual(before, P.local) && !isTyping()) render(false);
}
const isTyping = () => { const a = document.activeElement; return a && /INPUT|TEXTAREA/.test(a.tagName) && app.contains(a); };
window.addEventListener('online', () => { if (P.dirty) save(); });
window.addEventListener('pagehide', () => { store(); });
setInterval(async () => {
  if (document.visibilityState !== 'visible' || P.saving || !P.token || P.dirty) return;
  try { const r = await rpc('portal_open', { p_token: P.token }); if (r && r.ok && r.version > P.version && r.book) await absorb(r.book, r.version); } catch (_) {}
}, POLL_MS);

function setStatus(t, warn) {
  P.status = t;
  const el = document.getElementById('pstatus');
  if (el) { el.textContent = t; el.classList.toggle('warn', !!warn); }
}

/* ---------- views ---------- */
function fail(reason) {
  app.innerHTML = `<section class="card pad center"><div class="big-ic" aria-hidden="true">🔗</div><h2>לא ניתן לפתוח את הדוח</h2><p>${esc(REASONS[reason] || REASONS.invalid)}</p></section>`;
}
const curMonth = () => P.local.months.find(m => m.id === P.monthId) || P.local.months[P.local.months.length - 1] || null;

function templateCard() {
  const b = P.local;
  if (!b.templateUrl || b.templateDone) return '';
  return `<section class="card pad tpl"><h2>שלב ראשון: התבנית החודשית</h2>
    <p>לפני שמתחילים לעקוב, ממלאים פעם אחת את התבנית: ההכנסות וההוצאות של חודש רגיל. כך המאמנת בונה איתך את התקציב.</p>
    <a class="btn primary" href="${esc(b.templateUrl + (b.templateUrl.includes('#') ? '&b=1' : ''))}">למילוי התבנית</a></section>`;
}

function monthNav() {
  const cur = curMonth();
  return `<nav class="months" aria-label="חודשים">${P.local.months.map(m => `<button class="chip ${cur && m.id === cur.id ? 'on' : ''}" data-act="month" data-id="${esc(m.id)}" ${cur && m.id === cur.id ? 'aria-current="page"' : ''}>${esc(m.label || 'חודש')}</button>`).join('')}
    ${P.confirmNew ? `<span class="newm">לפתוח את ״${esc(nextMonthLabel(P.local))}״? <button class="btn primary sm" data-act="newmonth-yes">כן, לפתוח</button><button class="btn ghost sm" data-act="newmonth-no">ביטול</button></span>`
      : '<button class="chip addm" data-act="newmonth">+ חודש חדש</button>'}</nav>`;
}

// Once the coach has set a budget, the client sees exactly the budgeted lines (plus anything already filled in
// or added by the client); the template's unused default lines stay hidden.
const planned = m => Object.values(m.cats || {}).some(l => (l || []).some(it => n0(it.budget)));
function rowsHtml(m, s) {
  const strict = planned(m);
  const list = (s.income ? m.income : (m.cats[s.id] || []))
    .filter(it => it.by === 'client' || n0(it.amount) || n0(it.budget) || n0(it.paid) || (it.w || []).some(n0) || (!strict && String(it.label || '').trim()));
  const weekly = WEEKLY.has(s.id);
  return list.map(it => {
    const mine = it.by === 'client';
    const lab = mine ? `<input class="lab" data-f="label" data-c="${s.id}" data-i="${esc(it.id)}" value="${esc(it.label)}" placeholder="שם השורה" aria-label="שם השורה" maxlength="80">`
      : `<span class="plab">${esc(it.label || '—')}</span>`;
    const del = mine ? `<button class="x" data-act="delrow" data-c="${s.id}" data-i="${esc(it.id)}" aria-label="מחיקת השורה">×</button>` : '<span></span>';
    if (s.income) return `<div class="prow">${lab}<span class="cur"><input class="amt" data-f="amount" data-c="inc" data-i="${esc(it.id)}" value="${esc(nv(it.amount))}" inputmode="decimal" placeholder="0" aria-label="הכנסה – ${esc(it.label)}"></span>${del}</div>`;
    const budget = n0(it.budget) ? `<small class="bud">תקציב <span class="num">${fmt(it.budget)}</span></small>` : '';
    const end = it.end ? `<small class="bud">מסתיים ${esc(it.end.split('-').reverse().join('/'))}</small>` : '';
    if (weekly) {
      const tot = (it.w || []).reduce((a, x) => a + n0(x), 0);
      return `<div class="prow wk"><div class="wkh">${lab}${budget}<span class="num wtot" data-tot="${esc(it.id)}">${fmt(tot)}</span>${del}</div>
        <div class="weeks">${[0, 1, 2, 3, 4].map(k => `<label><small>שבוע ${k + 1}</small><input class="amt" data-f="w" data-w="${k}" data-c="${s.id}" data-i="${esc(it.id)}" value="${esc(nv((it.w || [])[k]))}" inputmode="decimal" placeholder="0" aria-label="${esc(it.label)} – שבוע ${k + 1}"></label>`).join('')}</div></div>`;
    }
    return `<div class="prow"><div class="plabw">${lab}${budget}${end}</div><span class="cur"><input class="amt" data-f="paid" data-c="${s.id}" data-i="${esc(it.id)}" value="${esc(nv(it.paid))}" inputmode="decimal" placeholder="0" aria-label="שולם – ${esc(it.label)}"></span>${del}</div>`;
  }).join('');
}

// the fixed categories, plus any the coach added for this client (filled once a month, like fixed expenses)
const sections = () => SECTIONS.concat(((P.local && P.local.extraCats) || []).map(x => ({ id: x.id, name: x.name, title: x.name, color: 'D6CFE0', kind: 'money', items: [], track: 'קטגוריה שהמאמנת הוסיפה עבורך. ממלאים פעם בחודש, או כשיש הוצאה.' })));
function sectionCard(m, s, t) {
  const tot = s.income ? t.inc : t.per[s.id].p, bud = s.income ? 0 : t.per[s.id].b;
  return `<details class="card sec" data-color="${s.color}" data-sec="${s.id}" ${P.open.has(s.id) ? 'open' : ''}>
    <summary><span class="sh"><b>${esc(s.title)}</b><span class="num" data-stot="${s.id}">${fmt(tot)}</span></span>${bud ? `<small>תקציב ${fmt(bud)}</small>` : ''}</summary>
    ${s.track ? `<p class="track">${esc(s.track)}</p>` : ''}
    <div class="rows">${rowsHtml(m, s) || '<p class="unit">אין שורות.</p>'}</div>
    <button class="add" data-act="addrow" data-c="${s.id}">+ הוספת שורה</button>
  </details>`;
}

function summary(t) {
  return `<section class="card psum">
    <div><small>הכנסות</small><b class="num" data-sum="inc">${fmt(t.inc)}</b></div>
    <div><small>שולם עד עכשיו</small><b class="num" data-sum="paid">${fmt(t.paid)}</b></div>
    <div><small>תקציב הוצאות</small><b class="num">${fmt(t.budget)}</b></div>
    <div><small>נשאר מההכנסות</small><b class="num ${t.left < 0 ? 'neg' : 'pos'}" data-sum="left">${fmt(t.left)}</b></div>
  </section>`;
}

function render(scroll = true) {
  const m = curMonth();
  let body = templateCard() + monthNav();
  if (!m) body += `<section class="card pad center"><p>עדיין אין חודש פתוח.</p><p class="unit">פותחים חודש חדש בכפתור ״+ חודש חדש״ למעלה.</p></section>`;
  else {
    const t = monthTotals(m);
    // categories with a budget or entries first; the rest stay folded, still there for an unplanned expense
    const secs = sections(), used = s => s.income || !!rowsHtml(m, s), rest = secs.filter(s => !used(s));
    body += `<p class="tip">💡 התקציב לכל סעיף נקבע בפגישה, ומופיע ליד הסעיף. ממלאים רק <b>כמה שולם בפועל</b>: הוצאות שבועיות פעם בשבוע, ביום קבוע (שבת, ראשון או שני), והוצאות חודשיות פעם בחודש. את ההכנסות מעדכנים כל חודש לפי מה שנכנס. הכל נשמר אוטומטית.</p>`
      + summary(t) + secs.filter(used).map(s => sectionCard(m, s, t)).join('')
      + (rest.length ? `<details class="card more"><summary>קטגוריות נוספות, בלי תקציב (${rest.length}): להוצאה שלא תוכננה</summary>${rest.map(s => sectionCard(m, s, t)).join('')}</details>` : '');
  }
  body += `<div class="pstatus" id="pstatus" role="status">${esc(P.status)}</div>`;
  app.innerHTML = body;
  app.querySelectorAll('[data-color]').forEach(el => el.style.setProperty('--cat', '#' + el.dataset.color));
  if (scroll) window.scrollTo(0, 0);
}

function refreshTotals() {
  const m = curMonth(); if (!m) return;
  const t = monthTotals(m);
  sections().forEach(s => { const el = app.querySelector(`[data-stot="${s.id}"]`); if (el) el.textContent = fmt(s.income ? t.inc : t.per[s.id].p); });
  const set = (k, v) => { const el = app.querySelector(`[data-sum="${k}"]`); if (el) el.textContent = fmt(v); };
  set('inc', t.inc); set('paid', t.paid); set('left', t.left);
  const l = app.querySelector('[data-sum="left"]'); if (l) { l.classList.toggle('neg', t.left < 0); l.classList.toggle('pos', t.left >= 0); }
  WEEKLY.forEach(id => (m.cats[id] || []).forEach(it => { const el = app.querySelector(`[data-tot="${CSS.escape(it.id)}"]`); if (el) el.textContent = fmt((it.w || []).reduce((a, x) => a + n0(x), 0)); }));
}

/* ---------- events ---------- */
const listOf = (m, c) => (c === 'inc' ? m.income : (m.cats[c] = m.cats[c] || []));
app.addEventListener('input', e => {
  const d = e.target.dataset; if (!d.f) return;
  const m = curMonth(); if (!m) return;
  const it = listOf(m, d.c).find(x => x.id === d.i); if (!it) return;
  if (d.f === 'label') it.label = e.target.value.slice(0, 80);
  else if (d.f === 'w') { it.w = it.w || [0, 0, 0, 0, 0]; it.w[+d.w] = n0(e.target.value); it.paid = it.w.reduce((a, x) => a + n0(x), 0); }
  else it[d.f] = n0(e.target.value);
  refreshTotals(); changed();
});
app.addEventListener('toggle', e => { const id = e.target.dataset && e.target.dataset.sec; if (id) { if (e.target.open) P.open.add(id); else P.open.delete(id); } }, true);
app.addEventListener('click', e => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  const m = curMonth();
  switch (b.dataset.act) {
    case 'month': P.monthId = b.dataset.id; P.confirmNew = false; store(); render(); break;
    case 'newmonth': P.confirmNew = true; render(false); break;
    case 'newmonth-no': P.confirmNew = false; render(false); break;
    case 'newmonth-yes': {
      const nm = newMonthFrom(P.local, nextMonthLabel(P.local));
      P.local.months.push(nm); P.monthId = nm.id; P.confirmNew = false; changed(); render(); break;
    }
    case 'addrow': {
      if (!m) break;
      const row = newRow(b.dataset.c); listOf(m, b.dataset.c).push(row); changed(); render(false);
      const el = app.querySelector(`input.lab[data-i="${CSS.escape(row.id)}"]`); if (el) el.focus();
      break;
    }
    case 'delrow': {
      if (!m) break;
      const list = listOf(m, b.dataset.c), i = list.findIndex(x => x.id === b.dataset.i);
      if (i >= 0 && list[i].by === 'client') { list.splice(i, 1); changed(); render(false); }
      break;
    }
  }
});

/* ---------- start ---------- */
async function start() {
  if (!cfg.supabaseUrl || !cfg.supabaseKey) return fail('config');
  const q = new URLSearchParams(location.hash.replace(/^#/, ''));
  P.token = q.get('t') || ''; P.key = q.get('s') || '';
  if (!/^[A-Za-z0-9_-]{22,64}$/.test(P.token) || !/^[A-Za-z0-9_-]{43}$/.test(P.key)) return fail('invalid');
  P.storeKey = 'cf-portal:' + (await sha256Hex(P.token)).slice(0, 24);
  let r;
  try { r = await rpc('portal_open', { p_token: P.token }); }
  catch (_) {
    const d = restore();
    if (!d) return fail('network');
    Object.assign(P, { base: d.base, local: d.local, version: d.version, monthId: d.monthId, dirty: !booksEqual(d.base, d.local) });
    render(); return setStatus('אין חיבור. מוצגת הגרסה השמורה במכשיר.', true);
  }
  if (!r || !r.ok) return fail((r && r.reason) || 'invalid');
  let remote;
  try { remote = normalizeBook(r.book ? await openSym(P.key, r.book, CTX) : {}); } catch (_) { return fail('key'); }
  const d = restore();
  if (d && !booksEqual(d.base, d.local)) {               // unsaved edits from last time
    P.local = mergeBooks(d.base, d.local, remote, 'client'); P.dirty = !booksEqual(P.local, remote);
  } else { P.local = clone(remote); P.dirty = false; }
  P.base = remote; P.version = r.version;
  P.monthId = d && d.monthId && P.local.months.some(m => m.id === d.monthId) ? d.monthId : null;
  store(); render();
  if (P.dirty) save();
}
start();

export { BY_ID };
