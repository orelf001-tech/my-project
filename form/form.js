// Client form: fills the monthly template, encrypts it in the browser and sends the
// ciphertext to the coach's mailbox. No third-party code runs on this page.
import { parseFormLink, seal, openSym, sha256Hex, kidOf } from '../shared/crypto.js';
import { SECTIONS, BY_ID, TEMPLATE_ID, TEMPLATE_VERSION, blankAnswers, normalizeAnswers, totals, monthlyOf } from '../shared/template.js';

if (window.top !== window.self) { document.documentElement.innerHTML = ''; throw new Error('framed'); }

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = v => { const n = parseFloat(String(v == null ? '' : v).replace(/[^\d.]/g, '')); return isFinite(n) ? n : 0; };
const fmt = n => (n < 0 ? '-' : '') + '₪' + Math.abs(Math.round(n)).toLocaleString('he-IL');
const nv = v => (v === '' || v == null ? '' : String(v));

const app = document.getElementById('app');
const cfg = window.CASHFLOW_CONFIG || {};
const STEPS = ['welcome'].concat(SECTIONS.map(s => s.id), ['review']);
const S = { step: 0, answers: null, consent: false, link: null, remaining: 0, done: false, sending: false, error: '', draftKey: '', tokenHash: '' };

const REASONS = {
  invalid: 'הקישור לא תקין. כדאי לבקש מהמאמנת קישור חדש.',
  revoked: 'הקישור בוטל. כדאי לבקש מהמאמנת קישור חדש.',
  expired: 'תוקף הקישור פג. כדאי לבקש מהמאמנת קישור חדש.',
  used: 'הטופס כבר נשלח. אם צריך לתקן משהו, אפשר לבקש מהמאמנת קישור חדש.',
  'wrong-key': 'הקישור פגום. כדאי לבקש מהמאמנת קישור חדש.',
  'bad-envelope': 'משהו השתבש בהצפנה. נסו לרענן את הדף.',
  config: 'הטופס עדיין לא חובר לשרת. כדאי לפנות למאמנת.',
  network: 'אין חיבור לשרת כרגע. הטיוטה שמורה במכשיר. בדקו את החיבור ונסו שוב.'
};

async function rpc(name, body) {
  const headers = { 'Content-Type': 'application/json', apikey: cfg.supabaseKey };
  if (/^eyJ/.test(cfg.supabaseKey)) headers.Authorization = 'Bearer ' + cfg.supabaseKey;
  let res;
  try {
    res = await fetch(cfg.supabaseUrl.replace(/\/+$/, '') + '/rest/v1/rpc/' + name, { method: 'POST', headers, body: JSON.stringify(body), credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer' });
  } catch (_) { throw new Error('network'); }
  if (!res.ok) throw new Error('network');
  return res.json();
}

/* ---------- draft (kept only on this device) ---------- */
let draftTimer = null;
function writeDraft() {
  clearTimeout(draftTimer); draftTimer = null;
  if (!S.answers || S.done) return;
  try { localStorage.setItem(S.draftKey, JSON.stringify({ answers: S.answers, step: S.step, t: Date.now() })); flashSaved('הטיוטה נשמרה'); } catch (_) {}
}
function saveDraft() { clearTimeout(draftTimer); draftTimer = setTimeout(writeDraft, 300); }
// Closing the tab or switching apps right after typing must not lose the last change.
window.addEventListener('pagehide', () => { if (draftTimer) writeDraft(); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && draftTimer) writeDraft(); });
function loadDraft() { try { const d = JSON.parse(localStorage.getItem(S.draftKey) || 'null'); return d && d.answers && d.answers.sections ? d : null; } catch (_) { return null; } }
function clearDraft() { try { localStorage.removeItem(S.draftKey); } catch (_) {} }
function flashSaved(t) { const el = document.getElementById('saved'); if (el) el.textContent = t; }

/* ---------- rendering ---------- */
function paint(html, focusSel) {
  app.innerHTML = html;
  app.querySelectorAll('[data-color]').forEach(el => el.style.setProperty('--cat', '#' + el.dataset.color));
  app.querySelectorAll('[data-w]').forEach(el => { el.style.width = el.dataset.w + '%'; });
  const f = focusSel && app.querySelector(focusSel);
  if (f) f.focus({ preventScroll: false });
}

function fail(reason) {
  paint(`<section class="card pad center"><div class="big-ic" aria-hidden="true">🔗</div><h2>לא ניתן לפתוח את הטופס</h2><p>${esc(REASONS[reason] || REASONS.invalid)}</p></section>`);
}

function nav(back, next, nextLabel, disabled) {
  return `<nav class="nav" aria-label="ניווט בטופס"><div class="in">
    ${back ? '<button class="btn ghost" data-act="back">הקודם</button>' : ''}
    <span class="grow saved" id="saved" aria-live="polite"></span>
    ${next ? `<button class="btn primary" data-act="${next}" ${disabled ? 'disabled' : ''}>${esc(nextLabel)}</button>` : ''}
  </div></nav>`;
}

function progress() {
  const i = S.step, n = STEPS.length - 1;
  return `<div class="progress"><span>שלב ${i + 1} מתוך ${n + 1}</span><span class="track" aria-hidden="true"><i data-w="${Math.round(i / n * 100)}"></i></span></div>`;
}

function welcomeView() {
  const a = S.answers;
  return `${progress()}
  <section class="card pad">
    <h2 tabindex="-1" id="h">שלום${a.name ? ' ' + esc(a.name) : ''} 👋</h2>
    <p class="lead">בטופס הזה ממלאים את ההכנסות וההוצאות של משק הבית בחודש רגיל. זה לוקח בערך 10–15 דקות.</p>
    <ul class="bullets">
      <li>שורה שלא רלוונטית פשוט משאירים ריקה.</li>
      <li>אפשר לשנות שם של שורה ולהוסיף שורות.</li>
      <li>הכול נשמר אוטומטית במכשיר הזה, אפשר לצאת ולחזור דרך אותו קישור.</li>
      <li>לא מבקשים כאן סיסמאות, קודים או מספרי כרטיס. אף פעם.</li>
    </ul>
    <div class="field mt"><label for="nm">שם (לא חובה)</label><input id="nm" class="txt" data-g="name" value="${esc(a.name)}" autocomplete="given-name" maxlength="80"></div>
    <div class="field"><label for="pr">לאיזה חודש מתייחסים המספרים? (לא חובה)</label><input id="pr" class="txt" data-g="period" value="${esc(a.period)}" placeholder="למשל: חודש רגיל, או ספטמבר 2026" maxlength="80"></div>
  </section>
  ${nav(false, 'next', 'מתחילים')}`;
}

function rowHtml(s, r, i) {
  const unit = s.kind === 'annual' ? 'בשנה' : 'בחודש';
  const lab = `<input class="lab" data-s="${s.id}" data-r="${i}" data-f="label" value="${esc(r.label)}" placeholder="${s.kind === 'ending' ? 'על מה? (למשל: מקרר)' : 'שם השורה'}" aria-label="שם השורה" maxlength="80">`;
  const amt = `<span class="cur"><input class="amt" data-s="${s.id}" data-r="${i}" data-f="amount" value="${esc(nv(r.amount))}" inputmode="decimal" autocomplete="off" placeholder="0" aria-label="סכום ${unit}${r.label ? ' – ' + esc(r.label) : ''}"></span>`;
  const del = `<button class="x" data-act="delrow" data-s="${s.id}" data-r="${i}" aria-label="מחיקת השורה${r.label ? ' ' + esc(r.label) : ''}">×</button>`;
  if (s.kind !== 'ending') return `<div class="row">${lab}${amt}${del}</div>`;
  return `<div class="row ending">${lab}${amt}${del}<label class="end">מסתיים ב־<input class="endm" type="month" data-s="${s.id}" data-r="${i}" data-f="end" value="${esc(r.end || '')}" aria-label="חודש סיום"></label></div>`;
}

function sectionTotal(s) { return (S.answers.sections[s.id] || []).reduce((a, r) => a + monthlyOf(s, { amount: num(r.amount) }), 0); }

function sectionView(s) {
  const rows = S.answers.sections[s.id] || [];
  const unit = s.kind === 'annual' ? 'סכום שנתי' : 'סכום חודשי';
  return `${progress()}
  <section class="card sec" data-color="${s.color}">
    <header><h2 tabindex="-1" id="h">${esc(s.title)}</h2>${s.hint ? `<p>${esc(s.hint)}</p>` : ''}</header>
    <div class="rows">
      <div class="row unit" aria-hidden="true"><span></span><span>${unit}</span><span></span></div>
      ${rows.map((r, i) => rowHtml(s, r, i)).join('')}
      ${rows.length ? '' : `<p class="unit">${s.kind === 'ending' ? 'אין? מצוין, אפשר להמשיך.' : 'אין שורות. אפשר להוסיף.'}</p>`}
    </div>
    <button class="add" data-act="addrow" data-s="${s.id}">+ ${s.kind === 'ending' ? 'הוספת ' + (s.id === 'loa' ? 'הלוואה' : 'עסקה') : 'הוספת שורה'}</button>
    <div class="tot"><span>${s.kind === 'annual' ? 'סה״כ לחודש (שנתי חלקי 12)' : 'סה״כ לחודש'}</span><span class="num" id="stot">${fmt(sectionTotal(s))}</span></div>
  </section>
  ${nav(true, 'next', 'המשך')}`;
}

function reviewView() {
  const a = normalizeAnswers(S.answers), t = totals(a);
  const line = s => `<tr><td><span class="dot" data-color="${s.color}"></span>${esc(s.title)}</td><td><span class="num">${fmt(t.per[s.id])}</span></td></tr>`;
  return `${progress()}
  <section class="card">
    <div class="pad"><h2 tabindex="-1" id="h">סיכום לפני שליחה</h2><p class="lead">אפשר לחזור לכל שלב ולתקן. הסכומים בחודש.</p></div>
    <table class="sum"><tbody>
      ${line(BY_ID.inc)}
      <tr class="t"><td>סה״כ הכנסות</td><td><span class="num">${fmt(t.income)}</span></td></tr>
      ${SECTIONS.filter(s => !s.income).map(line).join('')}
      <tr class="t"><td>סה״כ הוצאות</td><td><span class="num">${fmt(t.expenses)}</span></td></tr>
      <tr class="t"><td>הפרש</td><td><span class="num ${t.balance < 0 ? 'neg' : 'pos'}">${fmt(t.balance)}</span></td></tr>
    </tbody></table>
    <div class="pad">
      <div class="field"><label for="nt">משהו שחשוב שהמאמנת תדע? (לא חובה)</label><textarea id="nt" data-g="note" rows="4" maxlength="1000">${esc(S.answers.note)}</textarea></div>
      <label class="check"><input type="checkbox" id="consent" data-act="consent" ${S.consent ? 'checked' : ''}>
        <span>אני מאשר/ת לשלוח את המידע הזה למאמנת לצורך הליווי הפיננסי. המידע מוצפן במכשיר שלי לפני השליחה, נשמר בשרת רק עד שהמאמנת קולטת אותו, ונמחק ממנו לאחר מכן.</span></label>
      ${S.error ? `<div class="msg err" role="alert">${esc(S.error)}</div>` : ''}
    </div>
  </section>
  ${nav(true, 'send', S.sending ? 'שולח…' : 'שליחה מוצפנת למאמנת', !S.consent || S.sending)}`;
}

function doneView() {
  return `<section class="card pad center">
    <div class="big-ic" aria-hidden="true">✅</div>
    <h2 tabindex="-1" id="h">הטופס נשלח. תודה!</h2>
    <p>המידע הגיע מוצפן למאמנת, והטיוטה נמחקה מהמכשיר הזה.</p>
    ${S.remaining > 0 ? '<p class="unit">שכחת משהו? אפשר לחזור לטופס, לתקן ולשלוח שוב.</p><button class="btn" data-act="again">חזרה לטופס</button>' : ''}
  </section>`;
}

function render(focus = '#h') {
  if (S.done) return paint(doneView(), '#h');
  const id = STEPS[S.step];
  paint(id === 'welcome' ? welcomeView() : id === 'review' ? reviewView() : sectionView(BY_ID[id]), focus);
  if (focus === '#h') window.scrollTo(0, 0);
}

/* ---------- events ---------- */
app.addEventListener('input', e => {
  const t = e.target, d = t.dataset;
  if (d.g) { S.answers[d.g] = t.value; saveDraft(); return; }
  if (!d.s) return;
  const row = S.answers.sections[d.s][+d.r];
  if (!row) return;
  row[d.f] = t.value;
  if (d.f === 'amount') { const el = document.getElementById('stot'); if (el) el.textContent = fmt(sectionTotal(BY_ID[d.s])); }
  saveDraft();
});

app.addEventListener('change', e => {
  if (e.target.dataset.act === 'consent') { S.consent = e.target.checked; render(null); document.getElementById('consent').focus(); }
});

app.addEventListener('click', async e => {
  const b = e.target.closest('[data-act]');
  if (!b || b.dataset.act === 'consent') return;
  switch (b.dataset.act) {
    case 'next': S.step = Math.min(STEPS.length - 1, S.step + 1); S.error = ''; saveDraft(); render(); break;
    case 'back': S.step = Math.max(0, S.step - 1); S.error = ''; saveDraft(); render(); break;
    case 'addrow': {
      const s = BY_ID[b.dataset.s], list = S.answers.sections[s.id];
      list.push(s.kind === 'ending' ? { label: '', amount: '', end: '' } : { label: '', amount: '' });
      saveDraft(); render(null);
      const labs = app.querySelectorAll(`input.lab[data-s="${s.id}"]`); if (labs.length) labs[labs.length - 1].focus();
      break;
    }
    case 'delrow': S.answers.sections[b.dataset.s].splice(+b.dataset.r, 1); saveDraft(); render(null); break;
    case 'again': S.done = false; S.step = STEPS.length - 1; S.consent = false; render(); break;
    case 'send': await send(); break;
  }
});

async function send() {
  if (!S.consent || S.sending) return;
  S.sending = true; S.error = ''; render(null);
  try {
    const payload = { ...normalizeAnswers(S.answers), type: TEMPLATE_ID, version: TEMPLATE_VERSION, submittedAt: new Date().toISOString() };
    const env = await seal(S.link.publicRaw, payload);
    const r = await rpc('form_submit', { p_token: S.link.token, p_envelope: env });
    if (!r || !r.ok) { S.error = REASONS[(r && r.reason) || 'invalid'] || REASONS.invalid; return; }
    S.remaining = r.remaining;
    clearDraft();
    S.done = true;
  } catch (err) {
    S.error = REASONS[err.message] || REASONS.network;
  } finally {
    S.sending = false; render(S.done ? '#h' : null);
  }
}

/* ---------- start ---------- */
async function start() {
  if (!cfg.supabaseUrl || !cfg.supabaseKey) return fail('config');
  const link = parseFormLink(location.hash);
  if (!link) return fail('invalid');
  S.link = link;
  S.tokenHash = await sha256Hex(link.token);
  S.draftKey = 'cf-draft:' + S.tokenHash.slice(0, 24);
  let info;
  try { info = await rpc('form_open', { p_token: link.token }); } catch (_) { return fail('network'); }
  if (!info || !info.ok) return fail((info && info.reason) || 'invalid');
  if (info.kid !== await kidOf(link.publicRaw)) return fail('wrong-key');
  S.remaining = info.remaining;
  S.prefill = null;
  if (link.prefillKey && info.prefill) { try { S.prefill = await openSym(link.prefillKey, info.prefill, 'prefill|' + S.tokenHash); } catch (_) { S.prefill = null; } }
  const d = loadDraft();
  S.answers = d ? d.answers : blankAnswers(S.prefill);
  SECTIONS.forEach(s => { if (!Array.isArray(S.answers.sections[s.id])) S.answers.sections[s.id] = []; });
  S.step = d ? Math.min(STEPS.length - 1, Math.max(0, d.step | 0)) : 0;
  render();
  if (d) flashSaved('המשך מהטיוטה השמורה');
}
start();
