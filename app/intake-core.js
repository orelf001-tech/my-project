// Pure logic for client forms in the coach system: prefill, import into a month, insights.
// No DOM and no network here, so it is unit-tested directly (tests/unit).
import { SECTIONS, BY_ID, ALIASES, monthlyOf, totals } from './shared/template.js';

// Coach planning lines that are not something a client reports
export const COACH_ONLY = ['הקצאה לבלת״מ', 'יעדים כלליים'];
const PLACEHOLDER = /^(עסקה|הלוואה)\s*\d+$/;
const FIXED = ['hou', 'sub', 'ins', 'dea', 'sto', 'loa'];
const VARIABLE = ['var', 'trn', 'med'];

const n0 = v => { const n = typeof v === 'number' ? v : parseFloat(String(v == null ? '' : v).replace(/[^\d.\-]/g, '')); return isFinite(n) ? n : 0; };
export const normLabel = s => String(s || '').replace(/[״"׳'`]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();

export function sameLabel(a, b) {
  const x = normLabel(a), y = normLabel(b);
  if (!x || !y) return false;
  if (x === y) return true;
  return Object.entries(ALIASES).some(([k, vs]) => { const g = [k, ...vs].map(normLabel); return g.includes(x) && g.includes(y); });
}

const listOf = (month, id) => (id === 'inc' ? month.income : (month.cats[id] || (month.cats[id] = [])));

// The item list the client sees, taken from the coach's own month for this client.
export function buildPrefill(client, month) {
  const sections = {};
  SECTIONS.forEach(s => {
    const labels = (month ? listOf(month, s.id) : []).map(it => String(it.label || '').trim())
      .filter(l => l && !PLACEHOLDER.test(l) && !COACH_ONLY.includes(l));
    const seen = [];
    labels.forEach(l => { if (s.id === 'inc' || !seen.some(x => sameLabel(x, l))) seen.push(l); });
    sections[s.id] = seen.length || s.kind === 'ending' ? seen : s.items.slice();
  });
  return { name: String(client.name || '').trim().slice(0, 80), sections };
}

// Pick the month a form should prefill from: the baseline (first-month budget) if any, else the newest.
export const prefillMonth = client => client.months.find(m => m.baseline) || client.months[client.months.length - 1] || null;

/**
 * Write normalized answers into a tracking month.
 *   column: 'budget' (default) or 'paid' (variable expenses go into week 1)
 *   mode:   'fill'  -> only empty amounts are written
 *           'replace' -> amounts from the form overwrite what is there
 * Returns counts so the UI can report what happened. Never deletes rows.
 */
export function applyAnswers(month, answers, { column = 'budget', mode = 'fill', mkItem, uid }) {
  const res = { written: 0, added: 0, skipped: 0 };
  SECTIONS.forEach(s => {
    const list = listOf(month, s.id), used = new Set();
    (answers.sections[s.id] || []).forEach(row => {
      const value = monthlyOf(s, row);
      if (!row.label && !value) return;
      let it = list.find(x => !used.has(x) && sameLabel(x.label, row.label));
      // otherwise reuse an empty row, or a placeholder such as ״עסקה 1״ that has no amounts yet
      const free = x => { const l = String(x.label || '').trim(); return (!l || PLACEHOLDER.test(l)) && !n0(s.income ? x.amount : x.budget) && !n0(x.paid) && !(x.w || []).some(n0); };
      if (!it) it = list.find(x => !used.has(x) && free(x));
      if (!it) { it = s.income ? { id: uid(), label: '', amount: 0 } : mkItem(''); list.push(it); res.added++; }
      used.add(it);
      const l0 = String(it.label || '').trim();
      if (!l0 || PLACEHOLDER.test(l0)) it.label = row.label || s.name;
      let cur;
      if (s.income) cur = n0(it.amount);
      else if (column === 'paid') cur = s.id === 'var' ? (it.w || []).reduce((a, x) => a + n0(x), 0) : n0(it.paid);
      else cur = n0(it.budget);
      if (mode === 'fill' && cur) { res.skipped++; return; }
      if (s.income) it.amount = value;
      else if (column === 'paid' && s.id === 'var') it.w = [value, 0, 0, 0, 0];
      else if (column === 'paid') it.paid = value;
      else it.budget = value;
      if (s.kind === 'ending' && row.end && !it.end) it.end = row.end;
      if (s.kind === 'annual' && row.amount && !it.note) it.note = 'שנתי ₪' + Math.round(row.amount).toLocaleString('he-IL') + ' (מהטופס)';
      res.written++;
    });
  });
  return res;
}

// Side-by-side view: what the client reported vs what is in the coach's month now.
export function compare(month, answers) {
  return SECTIONS.map(s => {
    const list = month ? listOf(month, s.id) : [], used = new Set();
    const rows = (answers.sections[s.id] || []).map(row => {
      const it = list.find(x => !used.has(x) && sameLabel(x.label, row.label));
      if (it) used.add(it);
      const current = it ? n0(s.income ? it.amount : it.budget) : null;
      return { label: row.label, amount: row.amount, monthly: monthlyOf(s, row), end: row.end || '', current };
    });
    return { section: s, rows, total: rows.reduce((a, r) => a + r.monthly, 0) };
  });
}

const pctTxt = r => Math.round(r * 100) + '%';
const shekel = n => '₪' + Math.round(n).toLocaleString('he-IL');

// Points worth checking with the client. Heuristics to start a conversation, not financial advice.
export function insights(answers, now = new Date()) {
  const t = totals(answers), inc = t.income, per = t.per;
  const sum = ids => ids.reduce((a, id) => a + (per[id] || 0), 0);
  const ratios = {
    housing: inc ? per.hou / inc : 0,
    debt: inc ? (per.dea + per.loa) / inc : 0,
    fixed: inc ? sum(FIXED) / inc : 0,
    variable: inc ? sum(VARIABLE) / inc : 0,
    margin: inc ? t.balance / inc : 0
  };
  const flags = [];
  if (!inc) flags.push({ level: 'warn', text: 'לא דווחו הכנסות.' });
  if (t.balance < 0) flags.push({ level: 'bad', text: `ההוצאות שדווחו גבוהות מההכנסות ב־${shekel(-t.balance)} בחודש.` });
  else if (inc) flags.push({ level: 'ok', text: `לפי הדיווח נשארים ${shekel(t.balance)} בחודש (${pctTxt(ratios.margin)} מההכנסה).` });
  if (inc && ratios.housing > 0.35) flags.push({ level: 'warn', text: `מגורים: ${pctTxt(ratios.housing)} מההכנסה.` });
  if (inc && ratios.debt > 0.25) flags.push({ level: 'warn', text: `החזרי הלוואות ותשלומים: ${pctTxt(ratios.debt)} מההכנסה.` });
  if (inc && !per.var) flags.push({ level: 'warn', text: 'לא דווחו הוצאות משתנות (מזון, בילוי, ביגוד). כדאי לבדוק.' });
  if (!per.sto) flags.push({ level: 'info', text: 'לא דווחו הוצאות שנתיות. כדאי לשאול על חופשות, אירועים וטיפולי רכב.' });
  if (!per.ins) flags.push({ level: 'info', text: 'לא דווחו ביטוחים.' });
  const soon = new Date(now.getFullYear(), now.getMonth() + 3, 1);
  const soonKey = soon.getFullYear() + '-' + String(soon.getMonth() + 1).padStart(2, '0');
  const ending = ['dea', 'loa'].flatMap(id => (answers.sections[id] || []).filter(r => r.end && r.end <= soonKey && r.amount));
  if (ending.length) flags.push({ level: 'info', text: `מסתיימים בשלושת החודשים הקרובים: ${ending.map(r => `${r.label || 'ללא שם'} (${shekel(r.amount)})`).join(', ')}. זה יפנה כסף בתזרים.` });
  return { totals: t, ratios, flags };
}

export { BY_ID };
