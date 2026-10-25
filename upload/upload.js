// New-client onboarding: the client uploads credit-card and bank statements (Excel) for the
// initial analysis. Every file is encrypted here, to the coach's public key, before it leaves the device.
//   upload/#t=<access token>&k=<coach public key>
import { seal, kidOf, sha256Hex, b64uEncode } from '../shared/crypto.js';

if (window.top !== window.self) { document.documentElement.innerHTML = ''; throw new Error('framed'); }

const MAX_BYTES = 3 * 1024 * 1024;
const OK_EXT = /\.(xlsx|xls|csv)$/i;
const HEB_MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const app = document.getElementById('app');
const cfg = window.CASHFLOW_CONFIG || {};

// The last three FULL months, oldest first.
function lastMonths(now = new Date()) {
  const out = [];
  for (let i = 3; i >= 1; i--) { const d = new Date(now.getFullYear(), now.getMonth() - i, 1); out.push({ key: d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'), label: HEB_MONTHS[d.getMonth()] + ' ' + d.getFullYear() }); }
  return out;
}
const MONTHS = lastMonths();
const range = `${MONTHS[0].label} – ${MONTHS[2].label}`;

const U = { token: '', pub: '', storeKey: '', cards: [{ id: 'c1', name: '' }], files: [], busy: '', err: '', done: false };
// files: [{slot: 'card:c1:2026-07' | 'bank', name, size, at}]

const REASONS = {
  invalid: 'הקישור לא תקין. כדאי לבקש מהמאמנת קישור חדש.',
  revoked: 'הקישור בוטל. כדאי לבקש מהמאמנת קישור חדש.',
  expired: 'תוקף הקישור פג. כדאי לבקש מהמאמנת קישור חדש.',
  config: 'העמוד עדיין לא חובר לשרת. כדאי לפנות למאמנת.',
  network: 'אין חיבור לשרת כרגע. בדקו את החיבור ונסו שוב.',
  'wrong-key': 'הקישור פגום. כדאי לבקש מהמאמנת קישור חדש.',
  'too-large': 'הקובץ גדול מדי.',
  'too-many': 'הועלו כבר הרבה קבצים בקישור הזה. כדאי לפנות למאמנת.'
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

// Only names of what was uploaded are kept on this device, so the checklist survives a reload.
function store() { try { localStorage.setItem(U.storeKey, JSON.stringify({ cards: U.cards, files: U.files })); } catch (_) {} }
function restore() { try { const d = JSON.parse(localStorage.getItem(U.storeKey) || 'null'); if (d && Array.isArray(d.cards) && d.cards.length) { U.cards = d.cards; U.files = Array.isArray(d.files) ? d.files : []; } } catch (_) {} }

const filesIn = slot => U.files.filter(f => f.slot === slot);
const cardSlot = (c, m) => `card:${c.id}:${m.key}`;

function fail(reason) {
  app.innerHTML = `<section class="card pad center"><div class="big-ic" aria-hidden="true">🔗</div><h2>לא ניתן לפתוח את העמוד</h2><p>${esc(REASONS[reason] || REASONS.invalid)}</p></section>`;
}

function slotHtml(slot, label, hint) {
  const up = filesIn(slot);
  const busy = U.busy === slot;
  return `<div class="slot ${up.length ? 'ok' : ''}">
    <div class="sl"><span class="ic" aria-hidden="true">${up.length ? '✓' : '○'}</span><div><b>${esc(label)}</b>${hint ? `<small>${esc(hint)}</small>` : ''}
      ${up.map(f => `<small class="fn">📄 ${esc(f.name)}</small>`).join('')}</div></div>
    <label class="btn ${up.length ? 'ghost' : ''} ${busy ? 'dis' : ''}">${busy ? 'מצפין ומעלה…' : up.length ? 'הוספת קובץ' : 'בחירת קובץ'}
      <input type="file" accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" data-slot="${esc(slot)}" ${busy ? 'disabled' : ''} ${slot === 'bank' ? 'multiple' : ''}></label>
  </div>`;
}

function render() {
  if (U.done) {
    app.innerHTML = `<section class="card pad center"><div class="big-ic" aria-hidden="true">✅</div><h2>תודה! הקבצים הגיעו למאמנת</h2>
      <p>המאמנת תעבור על הנתונים לפני הפגישה. אחרי הפגישה, כשתבנו יחד את התקציב, תקבלו קישור לדוח החודשי.</p>
      <p><button class="btn ghost" data-act="more">שכחתי משהו, להעלות עוד קובץ</button></p></section>`;
    return;
  }
  const cardsTotal = U.cards.length * 3, cardsDone = U.cards.reduce((a, c) => a + MONTHS.filter(m => filesIn(cardSlot(c, m)).length).length, 0);
  const bankDone = filesIn('bank').length > 0;
  app.innerHTML = `
  <section class="card pad">
    <h2>מה צריך להעלות</h2>
    <p>כדי שנוכל לנתח את התזרים לפני הפגישה, מעלים כאן שני סוגי קבצים:</p>
    <ol class="need">
      <li><b>פירוט חשבון העו״ש:</b> ${esc(range)}, בקובץ Excel.</li>
      <li><b>פירוט כרטיסי אשראי:</b> מאותם חודשים, ${esc(MONTHS.map(m => '״פירוט ' + m.label.split(' ')[0] + '״').join(', '))}, בדיוק בשמות שמופיעים באתר של חברת האשראי. <b>קובץ Excel לכל חודש בנפרד.</b> יש כמה כרטיסים? מעלים כל כרטיס בנפרד.</li>
    </ol>
    <details class="how"><summary>איך מורידים קובץ Excel?</summary>
      <p><b>כרטיס אשראי:</b> באתר או באפליקציה של חברת האשראי (ישראכרט, כאל, מקס, אמריקן אקספרס, דיינרס): פירוט חיובים ← בוחרים את החודש בשם שמופיע כאן (למשל ״פירוט ${esc(MONTHS[2].label.split(' ')[0])}״) ← ״ייצוא ל־Excel״ או ״הורדה״. חוזרים על זה לכל חודש ולכל כרטיס.</p>
      <p class="unit">שימו לב: בפירוט של חודש מסוים רוב הקניות הן מהחודש שלפניו, כי החיוב יורד מהבנק בחודש שאחרי הקנייה. זה בסדר וזה מה שצריך: כך כל פירוט מתאים לחיוב שירד מהעו״ש באותו חודש.</p>
      <p><b>עו״ש:</b> באתר הבנק: חשבון עו״ש ← תנועות בחשבון ← בוחרים תקופה של 3 חודשים ← ״ייצוא ל־Excel״.</p>
      <p>מהטלפון זה לפעמים מסובך. באתר במחשב זה בדרך כלל פשוט יותר.</p>
    </details>
    <p class="unit">🔒 לא שולחים כאן סיסמאות, קודים או צילומי מסך. רק קבצי פירוט. כל קובץ מוצפן במכשיר שלך לפני שהוא נשלח.</p>
  </section>

  <section class="card">
    <div class="pad"><h2>כרטיסי אשראי <span class="cnt">${cardsDone} מתוך ${cardsTotal}</span></h2></div>
    ${U.cards.map((c, i) => `<div class="cardblk">
      <label class="field"><span>כרטיס ${i + 1}: שם החברה ו־4 הספרות האחרונות</span>
        <input class="txt" data-card="${esc(c.id)}" value="${esc(c.name)}" placeholder="למשל: ויזה כאל 1234" maxlength="40"></label>
      ${MONTHS.map(m => slotHtml(cardSlot(c, m), 'פירוט ' + m.label, '')).join('')}
      ${U.cards.length > 1 && !MONTHS.some(m => filesIn(cardSlot(c, m)).length) ? `<button class="link" data-act="delcard" data-id="${esc(c.id)}">הסרת הכרטיס</button>` : ''}
    </div>`).join('')}
    <button class="add" data-act="addcard">+ יש לי עוד כרטיס</button>
  </section>

  <section class="card">
    <div class="pad"><h2>חשבון עו״ש <span class="cnt">${bankDone ? '✓' : '0 מתוך 1'}</span></h2></div>
    <div class="cardblk">${slotHtml('bank', 'תנועות עו״ש: ' + range, 'אפשר קובץ אחד לשלושת החודשים, או קובץ לכל חודש. יש יותר מחשבון אחד? מעלים את כולם.')}</div>
  </section>

  ${U.err ? `<div class="msg err" role="alert">${esc(U.err)}</div>` : ''}
  <nav class="nav"><div class="in">
    <span class="grow saved">${U.files.length ? `הועלו ${U.files.length} קבצים` : ''}</span>
    <button class="btn primary" data-act="done" ${U.files.length && !U.busy ? '' : 'disabled'}>סיימתי להעלות</button>
  </div></nav>`;
}

async function upload(slot, file) {
  if (!OK_EXT.test(file.name)) {
    U.err = /\.pdf$/i.test(file.name) ? `הקובץ ״${file.name}״ הוא PDF. צריך קובץ Excel (בדרך כלל כפתור ״ייצוא ל־Excel״ באתר).` : `הקובץ ״${file.name}״ לא נראה כמו קובץ Excel.`;
    return;
  }
  if (file.size > MAX_BYTES) { U.err = `הקובץ ״${file.name}״ גדול מדי (עד 3MB).`; return; }
  const [kind, cardId, month] = slot.split(':');
  const card = kind === 'card' ? U.cards.find(c => c.id === cardId) : null;
  const monthLabel = month ? (MONTHS.find(m => m.key === month) || {}).label : '';
  const label = kind === 'card' ? `${(card && card.name.trim()) || 'כרטיס אשראי'} – ${monthLabel}` : `עו״ש – ${file.name.replace(/\.[^.]+$/, '')}`;
  const data = b64uEncode(new Uint8Array(await file.arrayBuffer()));
  const env = await seal(U.pub, { type: 'statement', kind: kind === 'card' ? 'card' : 'bank', card: card ? card.name.trim() : '', month: month || '', label, fileName: file.name, mime: file.type || '', size: file.size, data, uploadedAt: new Date().toISOString() });
  const r = await rpc('upload_file', { p_token: U.token, p_envelope: env });
  if (!r || !r.ok) { U.err = REASONS[(r && r.reason) || 'network'] || REASONS.network; return; }
  U.files.push({ slot, name: file.name, size: file.size, at: Date.now() });
  U.err = ''; store();
}

app.addEventListener('change', async e => {
  const t = e.target;
  if (!t.dataset.slot || !t.files || !t.files.length) return;
  const slot = t.dataset.slot, list = [...t.files];
  U.busy = slot; U.err = ''; render();
  try { for (const f of list) await upload(slot, f); }
  catch (err) { U.err = REASONS[err.message] || REASONS.network; }
  finally { U.busy = ''; render(); }
});
app.addEventListener('input', e => {
  const id = e.target.dataset.card; if (!id) return;
  const c = U.cards.find(x => x.id === id); if (c) { c.name = e.target.value.slice(0, 40); store(); }
});
app.addEventListener('click', async e => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  switch (b.dataset.act) {
    case 'addcard': U.cards.push({ id: 'c' + Date.now().toString(36), name: '' }); store(); render(); break;
    case 'delcard': U.cards = U.cards.filter(c => c.id !== b.dataset.id); store(); render(); break;
    case 'more': U.done = false; render(); break;
    case 'done': {
      b.disabled = true;
      try { const r = await rpc('upload_done', { p_token: U.token }); if (r && r.ok) { U.done = true; render(); window.scrollTo(0, 0); } else { U.err = REASONS.invalid; render(); } }
      catch (_) { U.err = REASONS.network; render(); }
      break;
    }
  }
});

async function start() {
  if (!cfg.supabaseUrl || !cfg.supabaseKey) return fail('config');
  const q = new URLSearchParams(location.hash.replace(/^#/, ''));
  U.token = q.get('t') || ''; U.pub = q.get('k') || '';
  if (!/^[A-Za-z0-9_-]{22,64}$/.test(U.token) || !/^[A-Za-z0-9_-]{87}$/.test(U.pub)) return fail('invalid');
  U.storeKey = 'cf-upload:' + (await sha256Hex(U.token)).slice(0, 24);
  let r;
  try { r = await rpc('upload_open', { p_token: U.token }); } catch (_) { return fail('network'); }
  if (!r || !r.ok) return fail((r && r.reason) || 'invalid');
  if (r.kid !== await kidOf(U.pub)) return fail('wrong-key');
  restore();
  render();
}
start();
