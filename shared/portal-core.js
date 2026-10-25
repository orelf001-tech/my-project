// The client's monthly book: the shared copy of the client's tracking months, edited both by the
// client (portal page) and by the coach (coach system). Stored on the server only encrypted.
//
// Sync is a three-way merge against the last version both sides agreed on (base):
//   a field changed on one side only  -> that change wins
//   a field changed on both sides     -> actual entries (paid, weeks, income amounts, notes) go to
//                                        the client, plan fields (budget, labels, end dates) to the coach
// Rows and months carry ids, so additions and deletions merge too.
import { SECTIONS } from './template.js';

export const BOOK_TYPE = 'cashflow-book';
export const TRACK_IDS = SECTIONS.filter(s => !s.income).map(s => s.id);
export const WEEKLY = new Set(['var', 'trn', 'med']);
const ACTUAL = new Set(['paid', 'w', 'amount', 'note']);

const n0 = v => { const n = typeof v === 'number' ? v : parseFloat(String(v == null ? '' : v).replace(/[^\d.\-]/g, '')); return isFinite(n) ? n : 0; };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const uid = () => Math.random().toString(36).slice(2, 9) + Math.random().toString(36).slice(2, 5);

const cleanItem = (it, cat) => {
  const o = { id: String(it.id), label: String(it.label || '').slice(0, 80) };
  if (cat === 'inc') { o.amount = n0(it.amount); }
  else {
    o.budget = n0(it.budget);
    o.w = Array.from({ length: 5 }, (_, i) => n0((it.w || [])[i]));
    if (WEEKLY.has(cat)) {
      // transport/health rows may hold a monthly amount entered as "paid" in the coach system
      if (cat !== 'var' && !o.w.some(Boolean) && n0(it.paid)) o.w[0] = n0(it.paid);
      o.paid = o.w.reduce((a, b) => a + b, 0);
    } else o.paid = n0(it.paid);
    o.note = String(it.note || '').slice(0, 200);
    if (it.end) o.end = String(it.end).slice(0, 7);
  }
  if (it.by === 'client') o.by = 'client';
  return o;
};

// Coach months -> book (only the fields that are shared with the client).
// Categories the coach added for one client (e.g. business expenses): {id: 'x…', name}
export const cleanExtraCats = list => (Array.isArray(list) ? list : []).filter(x => x && /^x[a-z0-9]{2,24}$/.test(x.id))
  .slice(0, 20).map(x => ({ id: x.id, name: String(x.name || '').slice(0, 40) }));
export const catIdsOf = book => TRACK_IDS.concat(cleanExtraCats(book && book.extraCats).map(x => x.id));

export function bookFromMonths(months, extra = {}) {
  const extraCats = cleanExtraCats(extra.extraCats), ids = TRACK_IDS.concat(extraCats.map(x => x.id));
  return {
    type: BOOK_TYPE, v: 1, ...extra, extraCats,
    months: months.filter(m => !m.locked).map(m => ({
      id: String(m.id), label: String(m.label || ''),
      income: (m.income || []).map(it => cleanItem(it, 'inc')),
      cats: Object.fromEntries(ids.map(id => [id, ((m.cats || {})[id] || []).map(it => cleanItem(it, id))]))
    }))
  };
}

export function normalizeBook(b) {
  const o = b && typeof b === 'object' ? b : {};
  return bookFromMonths(Array.isArray(o.months) ? o.months.map(m => ({ ...m, cats: m.cats || {} })) : [],
    { clientName: String(o.clientName || '').slice(0, 80), templateUrl: typeof o.templateUrl === 'string' ? o.templateUrl.slice(0, 600) : '', templateDone: !!o.templateDone, extraCats: o.extraCats });
}

function mergeScalar(b, l, r, key, localSide) {
  if (same(l, r)) return l;
  if (same(l, b)) return r;
  if (same(r, b)) return l;
  const clientWins = ACTUAL.has(key);
  return (clientWins === (localSide === 'client')) ? l : r;
}

function mergeObj(b, l, r, localSide) {
  const out = {};
  const keys = new Set([...Object.keys(l || {}), ...Object.keys(r || {})]);
  keys.forEach(k => {
    const bv = b ? b[k] : undefined, lv = l ? l[k] : undefined, rv = r ? r[k] : undefined;
    const v = mergeScalar(bv, lv, rv, k, localSide);
    if (v !== undefined) out[k] = v;
  });
  return out;
}

function mergeList(bL = [], lL = [], rL = [], mergeOne) {
  const B = new Map(bL.map(x => [x.id, x])), L = new Map(lL.map(x => [x.id, x])), R = new Map(rL.map(x => [x.id, x]));
  const order = lL.map(x => x.id).concat(rL.map(x => x.id).filter(id => !L.has(id)));
  const out = [];
  order.forEach(id => {
    const b = B.get(id), l = L.get(id), r = R.get(id);
    if (l && r) out.push(mergeOne(b, l, r));
    else if (l) { if (!b || !same(l, b)) out.push(l); }        // remote deleted an unchanged row -> drop
    else if (r) { if (!b || !same(r, b)) out.push(r); }        // local deleted an unchanged row -> drop
  });
  return out;
}

export function mergeBooks(base, local, remote, localSide) {
  const b = base || { months: [] };
  // the coach owns the list of extra categories
  const extraCats = cleanExtraCats((localSide === 'coach' ? local : remote).extraCats);
  const ids = TRACK_IDS.concat(extraCats.map(x => x.id));
  const months = mergeList(b.months, local.months, remote.months, (bm, lm, rm) => ({
    id: lm.id,
    label: mergeScalar(bm && bm.label, lm.label, rm.label, 'label', localSide),
    income: mergeList(bm && bm.income, lm.income, rm.income, (x, y, z) => mergeObj(x, y, z, localSide)),
    cats: Object.fromEntries(ids.map(id => [id, mergeList(bm && bm.cats[id], lm.cats[id], rm.cats[id], (x, y, z) => mergeObj(x, y, z, localSide))]))
  }));
  const meta = mergeObj({ clientName: b.clientName, templateUrl: b.templateUrl, templateDone: b.templateDone },
    { clientName: local.clientName, templateUrl: local.templateUrl, templateDone: local.templateDone },
    { clientName: remote.clientName, templateUrl: remote.templateUrl, templateDone: remote.templateDone }, localSide);
  return normalizeBook({ ...meta, extraCats, months });
}

export const booksEqual = (a, b) => same(normalizeBook(a), normalizeBook(b));

const HEB_MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];

export function nextMonthLabel(book, now = new Date()) {
  const labels = new Set(book.months.map(m => m.label));
  const last = book.months[book.months.length - 1];
  let y = now.getFullYear(), mo = now.getMonth();
  const m = last && new RegExp('^(' + HEB_MONTHS.join('|') + ')\\s+(\\d{4})$').exec(last.label.trim());
  if (m) { mo = HEB_MONTHS.indexOf(m[1]) + 1; y = +m[2]; if (mo > 11) { mo = 0; y++; } }
  let label = HEB_MONTHS[mo] + ' ' + y, i = 2;
  while (labels.has(label)) label = HEB_MONTHS[mo] + ' ' + y + ' (' + i++ + ')';
  return label;
}

// A new month copies the rows and budgets of the last month, with empty actual entries.
export function newMonthFrom(book, label) {
  const last = book.months[book.months.length - 1];
  const copy = it => ({ ...it, id: uid(), paid: 0, w: [0, 0, 0, 0, 0], note: '' });
  return {
    id: uid(), label,
    income: last ? last.income.map(it => ({ ...it, id: uid(), amount: 0 })) : SECTIONS[0].items.map(l => ({ id: uid(), label: l, amount: 0 })),
    cats: Object.fromEntries(catIdsOf(book).map(id => [id, last ? (last.cats[id] || []).map(copy)
      : ((SECTIONS.find(s => s.id === id) || { items: [] }).items.map(l => ({ id: uid(), label: l, budget: 0, paid: 0, w: [0, 0, 0, 0, 0], note: '' })))]))
  };
}

export function newRow(cat) {
  return cat === 'inc' ? { id: uid(), label: '', amount: 0, by: 'client' } : { id: uid(), label: '', budget: 0, paid: 0, w: [0, 0, 0, 0, 0], note: '', by: 'client' };
}

export function monthTotals(m) {
  const inc = (m.income || []).reduce((a, it) => a + n0(it.amount), 0);
  let budget = 0, paid = 0;
  const per = {};
  TRACK_IDS.concat(Object.keys(m.cats || {}).filter(id => !TRACK_IDS.includes(id))).forEach(id => {
    const b = (m.cats[id] || []).reduce((a, it) => a + n0(it.budget), 0);
    const p = (m.cats[id] || []).reduce((a, it) => a + (WEEKLY.has(id) ? (it.w || []).reduce((x, y) => x + n0(y), 0) : n0(it.paid)), 0);
    per[id] = { b, p }; budget += b; paid += p;
  });
  return { inc, budget, paid, per, left: inc - paid };
}
