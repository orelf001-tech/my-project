// Export the open client's reports to an Excel workbook (right-to-left, one sheet per report).
// Built entirely in the browser with the bundled SheetJS; nothing leaves the device.
import { SECTIONS, BY_ID, monthlyOf } from './shared/template.js';

const cf = window.__cf;
const n0 = v => { const n = typeof v === 'number' ? v : parseFloat(String(v == null ? '' : v).replace(/[^\d.\-]/g, '')); return isFinite(n) ? n : 0; };
const r2 = n => Math.round(n * 100) / 100;
const MONEY = '"₪"#,##0;[Red]-"₪"#,##0';
const PCT = '0.0%';
const dmy = iso => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '');

/* ---------- sheet builder ---------- */
// rows: arrays of cell values; a value may be {v, t:'m'|'p'|'b'} for money / percent / bold label.
function sheet(rows, widths) {
  const X = window.XLSX;
  const aoa = rows.map(r => r.map(c => (c && typeof c === 'object' ? c.v : c)));
  const ws = X.utils.aoa_to_sheet(aoa);
  rows.forEach((r, ri) => r.forEach((c, ci) => {
    const t = c && typeof c === 'object' ? c.t : (typeof c === 'number' ? 'm' : null);
    const cell = ws[X.utils.encode_cell({ r: ri, c: ci })];
    if (!cell || cell.t !== 'n') return;
    if (t === 'm') cell.z = MONEY;
    else if (t === 'p') cell.z = PCT;
  }));
  ws['!cols'] = widths.map(w => ({ wch: w }));
  return ws;
}
const M = v => ({ v: r2(n0(v)), t: 'm' });
const P = v => ({ v: isFinite(v) ? v : 0, t: 'p' });
const Q = v => ({ v, t: 'q' }); // plain number, no currency (counts)

const itemPaid = (cat, it) => (cat.weekly ? (it.w || []).reduce((a, x) => a + n0(x), 0) : n0(it.paid));

function summarySheet(c) {
  const rows = [['חודש', 'הכנסות', 'תקציב הוצאות', 'קבועות (שולם)', 'משתנות (שולם)', 'סה״כ שולם', 'נותר (הכנסות פחות שולם)', '% ניצול תקציב']];
  const T = { inc: 0, tb: 0, fix: 0, vr: 0, tp: 0, rem: 0 };
  c.months.forEach(m => {
    const t = cf.monthTot(m);
    rows.push([m.label, M(t.inc), M(t.tb), M(t.grp.fix.p), M(t.grp.vr.p), M(t.tp), M(t.rem), P(t.tb ? t.tp / t.tb : 0)]);
    T.inc += t.inc; T.tb += t.tb; T.fix += t.grp.fix.p; T.vr += t.grp.vr.p; T.tp += t.tp; T.rem += t.rem;
  });
  rows.push(['סה״כ לתקופה', M(T.inc), M(T.tb), M(T.fix), M(T.vr), M(T.tp), M(T.rem), P(T.tb ? T.tp / T.tb : 0)]);
  rows.push([]);
  rows.push(['שולם לפי קטגוריה'].concat(c.months.map(m => m.label), ['סה״כ']));
  cf.TRK_EXP.forEach(cat => {
    const v = c.months.map(m => cf.monthTot(m).per[cat.id].p);
    rows.push([cat.name].concat(v.map(M), [M(v.reduce((a, b) => a + b, 0))]));
  });
  return sheet(rows, [26, 14, 14, 14, 14, 14, 18, 12].concat(c.months.map(() => 14)));
}

function monthSheet(m) {
  const rows = [['קטגוריה', 'סעיף', 'תקציב', 'שולם', 'נותר', 'שבוע 1', 'שבוע 2', 'שבוע 3', 'שבוע 4', 'שבוע 5', 'מסתיים', 'הערה']];
  let incT = 0;
  (m.income || []).filter(it => String(it.label || '').trim() || n0(it.amount)).forEach(it => { rows.push(['הכנסות', it.label, M(it.amount)]); incT += n0(it.amount); });
  rows.push([{ v: 'סה״כ הכנסות', t: 'b' }, '', M(incT)]);
  rows.push([]);
  let tb = 0, tp = 0;
  cf.TRK_EXP.forEach(cat => {
    const items = (m.cats[cat.id] || []).filter(it => String(it.label || '').trim() || n0(it.budget) || itemPaid(cat, it));
    if (!items.length) return;
    let b = 0, p = 0;
    items.forEach(it => {
      const paid = itemPaid(cat, it);
      b += n0(it.budget); p += paid;
      rows.push([cat.name, it.label, M(it.budget), M(paid), M(n0(it.budget) - paid)]
        .concat(cat.weekly ? (it.w || [0, 0, 0, 0, 0]).map(M) : ['', '', '', '', ''], [it.end || '', it.note || '']));
    });
    rows.push([{ v: 'סה״כ ' + cat.name, t: 'b' }, '', M(b), M(p), M(b - p)]);
    tb += b; tp += p;
  });
  rows.push([]);
  rows.push([{ v: 'סה״כ הוצאות', t: 'b' }, '', M(tb), M(tp), M(tb - tp)]);
  rows.push([{ v: 'נותר מההכנסות (הכנסות פחות שולם)', t: 'b' }, '', M(incT - tp)]);
  return sheet(rows, [24, 26, 13, 13, 13, 11, 11, 11, 11, 11, 10, 30]);
}

function reportSheet(R) {
  const head = ['קטגוריה', 'סעיף'].concat(R.months.map(m => cf.mLabel(m.k) + (m.incl ? '' : ' (לא בממוצע)')), ['ממוצע חודשי']);
  const rows = [head];
  const line = (name, sub, getter, avg) => rows.push([name, sub].concat(R.months.map(m => M(getter(m.k))), [M(avg)]));
  const subs = id => (R.subs[id] || []).filter(s => s !== '');
  line('הכנסות', '', k => R.income(k), R.avgInc);
  subs('inc').forEach(s => line('', s, k => (R.SM[k] || {})['inc/' + s] || 0, R.avgSub('inc/' + s)));
  rows.push([]);
  R.catList.forEach(id => {
    const has = R.months.some(m => (R.M[m.k] || {})[id]);
    if (!has) return;
    line(id === 'uns' ? 'ללא שיוך' : cf.BY[id].name, '', k => (R.M[k] || {})[id] || 0, R.avg(id));
    subs(id).forEach(s => line('', s, k => (R.SM[k] || {})[id + '/' + s] || 0, R.avgSub(id + '/' + s)));
  });
  rows.push([]);
  line('סה״כ הוצאות', '', k => R.total(k), R.avgExp);
  line('הפרש (הכנסות פחות הוצאות)', '', k => R.income(k) - R.total(k), R.avgInc - R.avgExp);
  rows.push([]);
  rows.push([`הממוצע מחושב על ${R.nIncl} חודשים. חודשים חלקיים מסומנים ״לא בממוצע״.`]);
  return sheet(rows, [26, 26].concat(R.months.map(() => 15), [15]));
}

function txSheet(c) {
  const rows = [['תאריך', 'תאריך חיוב', 'תיאור', 'סכום', 'סוג', 'מקור', 'תדפיס', 'קטגוריה', 'פרטים']];
  c.rep.tx.slice().sort((a, b) => (a.date < b.date ? -1 : 1)).forEach(t => {
    rows.push([dmy(t.date), dmy(t.cd), t.desc, M(t.kind === 'exp' ? -t.amt : t.amt), t.kind === 'inc' ? 'הכנסה' : 'הוצאה',
      t.type === 'card' ? 'אשראי' : 'עו״ש', cf.srcName(t.src), cf.catLabel(cf.catStr(t)), t.ex || '']);
  });
  return sheet(rows, [11, 11, 34, 13, 8, 8, 20, 30, 30]);
}

function installmentsSheet() {
  const I = cf.buildInstallments();
  const rows = [['בית עסק', 'תאריך העסקה', 'סכום העסקה', 'תשלום חודשי', 'תשלום', 'מתוך', 'נשארו', 'יתרה לתשלום', 'מסתיים', 'מצב']];
  I.list.forEach(x => rows.push([x.desc, dmy(x.date), x.pa ? M(x.pa) : '', M(x.amt), Q(x.n), x.N ? Q(x.N) : '', x.remaining == null ? '' : Q(x.remaining),
    x.remAmt == null ? '' : M(x.remAmt), x.endKey ? cf.mLabel(x.endKey) : '', x.active ? 'פעילה' : (x.done ? 'הסתיימה' : 'לא ידוע')]));
  rows.push([]);
  rows.push([{ v: 'סה״כ עסקאות פעילות', t: 'b' }, '', '', M(I.monthly), '', '', '', M(I.remTotal)]);
  return sheet(rows, [32, 12, 13, 13, 8, 8, 8, 14, 14, 10]);
}

function formsSheet(c) {
  const rows = [['התקבל', 'מתייחס ל', 'קטגוריה', 'סעיף', 'סכום שדווח', 'לחודש', 'מסתיים', 'הערת הלקוח/ה', 'ההערות שלי']];
  (c.forms || []).forEach(f => {
    const a = f.answers || { sections: {} };
    let first = true;
    SECTIONS.forEach(s => (a.sections[s.id] || []).filter(r => r.amount).forEach(r => {
      rows.push([dmy(f.receivedAt), a.period || '', s.name, r.label, M(r.amount), M(monthlyOf(s, r)), r.end || '', first ? a.note || '' : '', first ? f.note || '' : '']);
      first = false;
    }));
    rows.push([]);
  });
  return sheet(rows, [11, 16, 24, 26, 13, 13, 10, 30, 30]);
}

function safeName(name, used) {
  let s = String(name || 'גיליון').replace(/[\[\]:*?\/\\]/g, ' ').trim().slice(0, 28) || 'גיליון';
  let out = s, i = 2;
  while (used.has(out)) out = s.slice(0, 26) + ' ' + i++;
  used.add(out);
  return out;
}

export function exportClient() {
  const X = window.XLSX;
  if (!X || !X.utils || !X.writeFile) throw new Error('xlsx-missing');
  const c = cf.cl();
  if (c.rep.tx.length) cf.recomputeIfNeeded();
  const wb = X.utils.book_new(), used = new Set();
  const add = (ws, name) => X.utils.book_append_sheet(wb, ws, safeName(name, used));
  add(summarySheet(c), 'סיכום חודשים');
  c.months.forEach(m => add(monthSheet(m), m.label || 'חודש'));
  if (c.rep.tx.length) {
    add(reportSheet(cf.buildReport()), 'דוח ראשוני');
    add(installmentsSheet(), 'עסקאות בתשלומים');
    add(txSheet(c), 'תנועות');
  }
  if ((c.forms || []).length) add(formsSheet(c), 'טפסים מהלקוח');
  wb.Workbook = { Views: [{ RTL: true }] };
  wb.Props = { Title: 'ניהול תזרים – ' + c.name, CreatedDate: new Date() };
  const date = new Date().toISOString().slice(0, 10);
  const file = `ניהול-תזרים-${String(c.name || 'לקוח').replace(/[\\/:*?"<>|]/g, ' ')}-${date}.xlsx`;
  X.writeFile(wb, file, { compression: true });
  return { file, sheets: wb.SheetNames };
}

document.addEventListener('click', e => {
  const b = e.target.closest ? e.target.closest('[data-act="xlsx"]') : null;
  if (!b) return;
  try { exportClient(); }
  catch (err) { alert('לא הצלחתי ליצור את קובץ ה־Excel. נסי לרענן את הדף ולנסות שוב.'); }
});

window.CFExport = { exportClient };
export { BY_ID };
