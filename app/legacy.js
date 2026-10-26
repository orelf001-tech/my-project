// Cashflow management system (migrated from the claude.ai artifact). Integration points: window.__cf, window.CFIntake.
(function(){
'use strict';
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num = x => { if (typeof x === 'number') return isFinite(x) ? x : 0; const n = parseFloat(String(x == null ? '' : x).replace(/[^\d.\-]/g, '')); return isFinite(n) ? n : 0; };
const uid = () => Math.random().toString(36).slice(2, 9);
const r2 = n => Math.round(n * 100) / 100;
const fmt = (n, dash) => { n = r2(n); if (dash && n === 0) return '–'; return (n < 0 ? '-' : '') + '₪' + Math.abs(n).toLocaleString('he-IL', {maximumFractionDigits: 2}); };
const fmt0 = n => { n = Math.round(n); return (n < 0 ? '-' : '') + '₪' + Math.abs(n).toLocaleString('he-IL'); };
const pct = n => (Math.round(n * 1000) / 10).toFixed(1) + '%';
const nv = n => { n = num(n); return n === 0 ? '' : n.toLocaleString('he-IL', {maximumFractionDigits: 2}); };
const MONTHS = ['ינואר','פברואר','מרץ','אפריל','מאי','יוני','יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר'];
const MSHORT = ['ינו׳','פבר׳','מרץ','אפר׳','מאי','יוני','יולי','אוג׳','ספט׳','אוק׳','נוב׳','דצמ׳'];
const mLabel = k => { const [y, m] = k.split('-'); return MONTHS[+m - 1] + ' ' + y; };
const mShort = k => { const [y, m] = k.split('-'); return MSHORT[+m - 1] + ' ' + y.slice(2); };

/* ================= categories ================= */
const CATS = [
  {id:'inc', name:'הכנסות',                    color:'B7D3BE', income:true},
  {id:'var', name:'משתנות',                    color:'AFC9CB', kind:'var',   weekly:true},
  {id:'hou', name:'הוצאות מגורים',             color:'E3CFA6', kind:'fixed'},
  {id:'sub', name:'הוצאות מתחדשות וחודשיות',   color:'CDD6C8', kind:'fixed'},
  {id:'trn', name:'הוצאות תחבורה',             color:'B5D0DA', kind:'var'},
  {id:'med', name:'הוצאות רפואיות',            color:'E2C6BE', kind:'var'},
  {id:'ins', name:'ביטוחים',                   color:'EEDFB8', kind:'fixed'},
  {id:'dea', name:'עסקאות תשלומים פתוחות',     color:'C9D5BC', kind:'fixed'},
  {id:'sto', name:'מחסנים והוצאות שנתיות',     color:'BFD0D7', kind:'fixed'},
  {id:'loa', name:'הלוואות',                   color:'D9C3C3', kind:'fixed'},
  {id:'oth', name:'אחר',                       color:'D0D6D2', kind:'var'},
  {id:'cash', name:'משיכות מזומן',             color:'D7E3D1', kind:'mv'},
  {id:'apps', name:'ביט / פייבוקס',            color:'D9D4E8', kind:'mv'},
  {id:'trf',  name:'העברות בנקאיות',           color:'E8D9CC', kind:'mv'},
  {id:'abr',  name:'הוצאות חו״ל',              color:'CFE1EA', kind:'mv'}
];
const PSEUDO = [
  {id:'uns',  name:'ללא שיוך',                         color:'EADFC0'},
  {id:'skip', name:'לא נספר (הצלבה / העברות)',         color:'DDDDD8'},
  {id:'once', name:'חד פעמי (מחוץ לחישוב)',             color:'F0E4C8'}
];
const BY = {}; CATS.concat(PSEUDO).forEach(c => BY[c.id] = c);
const EXP = CATS.filter(c => !c.income);
const NOT_IN_MONTHS = ['oth', 'cash', 'apps', 'trf', 'abr'];   // analysis only, never in the monthly budget
const TRK_EXP = EXP.filter(c => !NOT_IN_MONTHS.includes(c.id));
const GROUPS = [
  {id:'fix', name:'הוצאות קבועות', cats:['hou','sub','ins','dea','sto','loa']},
  {id:'vr',  name:'הוצאות משתנות', cats:['var','trn','med','oth','abr']},
  {id:'mv',  name:'מזומן והעברות', cats:['cash','apps','trf']}
];
/* Categories the coach adds for one client (e.g. "הוצאות עסק"). While that client is open they are appended to
   the shared lists above, so the picker, the report, the budget months and the export all include them. */
let catsSig = null;
function applyClientCats(c){
  const list = (c && c.extraCats) || [], sig = (c ? c.id : '') + '|' + list.map(x => x.id + ':' + x.name).join(',');
  if (sig === catsSig) return; catsSig = sig;
  [CATS, EXP, TRK_EXP, GROUPS].forEach(arr => { for (let i = arr.length - 1; i >= 0; i--) if (arr[i].custom) arr.splice(i, 1); });
  Object.keys(BY).forEach(k => { if (BY[k].custom) delete BY[k]; });
  const defs = list.map(x => ({id:x.id, name:x.name, color:'D6CFE0', kind:'fixed', custom:true}));
  defs.forEach(d => { CATS.push(d); EXP.push(d); TRK_EXP.push(d); BY[d.id] = d; });
  if (defs.length) GROUPS.push({id:'cus', name:'קטגוריות של הלקוח', cats:defs.map(d => d.id), custom:true});
  if (c) c.months.forEach(m => defs.forEach(d => { if (!m.cats[d.id]) m.cats[d.id] = []; }));
  const dl = typeof document !== 'undefined' && document.getElementById('catDL'); if (dl) dl.remove();
}
function addClientCat(name){
  const c = cl(); name = String(name || '').replace(/\s+/g, ' ').trim().slice(0, 40); if (!name) return 'צריך לכתוב שם לקטגוריה.';
  if (CATS.concat(PSEUDO).some(x => x.name === name)) return 'כבר יש קטגוריה בשם הזה.';
  c.extraCats = (c.extraCats || []).concat({id:'x' + uid().replace(/[^a-z0-9]/g, '').slice(0, 10), name});
  applyClientCats(c); persist(); return '';
}
function catInUse(id){
  const c = cl(), rep = c.rep;
  return rep.tx.some(t => String(catStr(t)).split('/')[0] === id) || Object.values(rep.rules || {}).some(v => String(v).split('/')[0] === id)
    || c.months.some(m => (m.cats[id] || []).some(it => num(it.budget) || num(it.paid) || (it.w || []).some(num)));
}
function delClientCat(id){
  // rows assigned to it go back to "ללא שיוך" (the rules that sent them there are dropped); its budget lines go away
  const c = cl(), rep = c.rep, of = v => String(v || '').split('/')[0] === id;
  rep.tx.forEach(t => { if (t.man && of(t.cat)) { t.man = false; t.cat = null; } });
  Object.keys(rep.rules || {}).forEach(k => { if (of(rep.rules[k])) delete rep.rules[k]; });
  if (rep.xfer) Object.keys(rep.xfer).forEach(k => { if (of(k)) delete rep.xfer[k]; });
  c.extraCats = (c.extraCats || []).filter(x => x.id !== id); c.months.forEach(m => { delete m.cats[id]; }); if (c.extraSubs) delete c.extraSubs[id];
  applyClientCats(c); recomputeAll(); persist(); return true;
}
const TGROUPS_OF = () => GROUPS.map(g => ({id:g.id, name:g.name, cats:g.cats.filter(id => !NOT_IN_MONTHS.includes(id))})).filter(g => g.cats.length);
const DEFAULTS = {
  inc:{items:['משכורת','משכורת','קצבת ילדים','עסק','הכנסה נוספת','הכנסה נוספת'], spare:0},
  var:{items:['מזון ומכולת','בילוי ומסעדות','ביגוד והנעלה','תחזוקת בית','מספרה','קוסמטיקה','רכישות ברשת','פארם'], spare:3},
  hou:{items:['משכנתא','שכר דירה','חשמל (חודשי)','מים (חודשי)','ארנונה (חודשי)','גז','אינטרנט','טלפון','כבלים','וועד','אבטחה'], spare:2},
  sub:{items:['נטפליקס','ספוטיפיי','apple','google','chat gpt','free tv','תרומות'], spare:2},
  trn:{items:['שיפית רכב','דלק / חשמל','חניה','כביש 6','תחבורה ציבורית'], spare:2},
  med:{items:['קופת חולים','תרופות','פסיכולוג','טיפול רגשי','שיניים'], spare:2},
  ins:{items:['ביטוח דירה','ביטוח חיים','ביטוח רכב','ביטוח בריאות','תאונות אישיות'], spare:2},
  dea:{items:['עסקה 1','עסקה 2','עסקה 3','עסקה 4','עסקה 5','עסקה 6','עסקה 7','עסקה 8'], spare:0},
  sto:{items:['הקצאה לבלת״מ','חופשה שנתית','יעדים כלליים','טיפול רכב','טסט','שמחות ואירועים','ימי הולדת','אירוח בחגים'], spare:2},
  loa:{items:['הלוואה 1','הלוואה 2','הלוואה 3'], spare:0},
  oth:{items:[], spare:5},
  cash:{items:['משיכות מזומן'], spare:2}, apps:{items:['ביט / פייבוקס'], spare:2}, trf:{items:[], spare:3}, abr:{items:[], spare:3}
};

/* ================= workspace (clients) ================= */
const KEY2 = 'cashflow-system-v2', KEY1 = 'cashflow-system-v1';
const mkItem = label => ({id:uid(), label:label || '', budget:0, paid:0, w:[0,0,0,0,0], note:''});
function newMonth(label, from, copyBudgets){
  const m = {id:uid(), label:label, income:[], cats:{}};
  if (from) {
    m.income = from.income.map(i => ({id:uid(), label:i.label, amount: copyBudgets ? num(i.amount) : 0}));
    // a fixed expense the client marked (rent, a loan…) keeps its amount until its end month
    const nowKey = new Date().toISOString().slice(0, 7);
    EXP.forEach(c => { m.cats[c.id] = (from.cats[c.id] || []).map(it => { const n = mkItem(it.label); if (copyBudgets) n.budget = num(it.budget); if (it.end) n.end = it.end;
      if (it.fixed && c.id !== 'var' && !(it.end && it.end < nowKey)) { n.fixed = true; n.paid = num(it.paid); n.w = (it.w || [0, 0, 0, 0, 0]).slice(); if (it.by) n.by = it.by; } return n; }); });
  } else {
    m.income = DEFAULTS.inc.items.map(l => ({id:uid(), label:l, amount:0}));
    EXP.forEach(c => { const d = DEFAULTS[c.id] || {items:[], spare:2}; m.cats[c.id] = d.items.map(mkItem).concat(Array.from({length:d.spare}, () => mkItem(''))); });
  }
  return m;
}
const newRep = () => ({sources:[], tx:[], rules:{}, excl:{}, cardBy:'tx', manualIncome:0, dupes:0, del:{}});
function newClient(name){ const m = newMonth('חודש 1'); return {id:uid(), name:name, view:ws && ws.clientMode ? 'load' : 'intake', monthId:m.id, months:[m], rep:newRep(), itemsRepaired:true}; }
const validMonths = a => Array.isArray(a) && a.length > 0 && a.every(m => m && m.id && Array.isArray(m.income) && m.cats);
function validWs(s){ return s && Array.isArray(s.clients) && s.clients.length > 0 && s.clients.every(c => c && c.id && validMonths(c.months) && c.rep && Array.isArray(c.rep.tx)); }
function load(){
  try {
    const raw = localStorage.getItem(KEY2);
    if (raw) { const s = JSON.parse(raw); if (validWs(s)) return s; }
    const old = localStorage.getItem(KEY1);
    if (old) { const o = JSON.parse(old); if (o && validMonths(o.months)) { const c = newClient('לקוח/ה 1'); c.months = o.months; c.monthId = o.months[0].id; c.view = 'summary'; return {v:2, cid:c.id, clients:[c]}; } }
  } catch(e) {}
  return null;
}
const SNAPKEY = KEY2 + '-snapshots';
function snapshots(){ try { return JSON.parse(localStorage.getItem(SNAPKEY) || '[]'); } catch(e) { return []; } }
(function takeSnapshot(){ try { const raw = localStorage.getItem(KEY2); if (!raw) return; const list = snapshots(), today = new Date().toISOString().slice(0, 10);
  if (list.length && list[list.length - 1].t.slice(0, 10) === today) return;
  list.push({t:new Date().toISOString(), data:raw}); while (list.length > 7) list.shift(); localStorage.setItem(SNAPKEY, JSON.stringify(list)); } catch(e) {} })();
let ws = load();
if (ws) ws.clients.forEach(c => {
  c.months.forEach(m => { EXP.forEach(cat => { if (!m.cats[cat.id]) m.cats[cat.id] = []; }); ['cash', 'apps', 'trf', 'abr'].forEach(id => { m.cats[id] = []; }); });
  const old = c.months.find(m => m.label === 'תקציב מוצע' && !m.baseline);
  if (old && !c.months.some(m => m.baseline)) { old.baseline = true; old.label = 'תקציב – חודש ראשון'; (old.cats.oth || []).forEach(it => { if (it.label === 'ללא שיוך (ממוצע)') it.budget = 0; }); }
  c.months.forEach(m => {
    Object.keys(m.cats).forEach(id => { if (id === 'var') { (m.cats[id] || []).forEach(it => { if (it.cur && it.budget === it.cur) it.budget = 0; delete it.cur; }); return; }
      (m.cats[id] || []).forEach(it => { if (num(it.cur) && !num(it.budget)) it.budget = it.cur; delete it.cur; }); });
    (m.income || []).forEach(it => { if (num(it.cur) && !num(it.amount)) it.amount = it.cur; delete it.cur; });
  });
  // one-time repair: bring back the full item lists that an earlier version removed. Runs once per client, so rows the coach deletes stay deleted.
  if (!c.itemsRepaired) c.months.forEach(m => {
    TRK_EXP.forEach(cat => {
      const list = (m.cats[cat.id] || []).map(it => { if (it.label === 'שכ״ד') it.label = 'שכר דירה'; return it; });
      const defs = (DEFAULTS[cat.id] || {items:[]}).items;
      const used = new Set();
      const ordered = defs.map(lab => { const found = list.find(it => it.label.trim() === lab && !used.has(it)); if (found) { used.add(found); return found; } return mkItem(lab); });
      const rest = list.filter(it => !used.has(it));
      const named = rest.filter(it => it.label.trim() || num(it.budget) || num(it.paid) || (it.w || []).some(x => num(x)));
      const blanks = rest.filter(it => !named.includes(it)).slice(0, 2);
      m.cats[cat.id] = ordered.concat(named, blanks.length ? blanks : [mkItem('')]);
    });
    const incDefs = DEFAULTS.inc.items, incUsed = new Set();
    const incOrdered = incDefs.map(lab => { const f = (m.income || []).find(it => it.label.trim() === lab && !incUsed.has(it)); if (f) { incUsed.add(f); return f; } return {id:uid(), label:lab, amount:0}; });
    m.income = incOrdered.concat((m.income || []).filter(it => !incUsed.has(it) && (it.label.trim() || num(it.amount))));
  });
  c.itemsRepaired = true;
  const base = c.months.find(m => m.baseline);
  if (base) {
    c.months = [base].concat(c.months.filter(m => m !== base));
    if (!c.months.some(m => m.id === c.monthId)) c.monthId = base.id;
  }
});
if (!ws) { const c = newClient('לקוח/ה 1'); ws = {v:2, cid:c.id, clients:[c]}; }
const cl = () => ws.clients.find(c => c.id === ws.cid) || ws.clients[0];
const curMonth = () => { const c = cl(); if (c.view === 'template') return c.template ? c.template.month : null; return c.months.find(m => m.id === c.monthId) || null; };
let saveTimer = null;
function setSaved(t){ const el = document.getElementById('saved'); if (el) el.textContent = t; }
function saveNow(){ clearTimeout(saveTimer); saveTimer = null; try { localStorage.setItem(KEY2, JSON.stringify(ws)); setSaved('נשמר ✓'); } catch(e) { setSaved('לא ניתן לשמור בדפדפן הזה'); } }
function persist(){ clearTimeout(saveTimer); saveTimer = setTimeout(saveNow, 250); }
// a refresh or closing the tab right after a change must not lose it
window.addEventListener('pagehide', () => { if (saveTimer) saveNow(); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && saveTimer) saveNow(); });
const ui = {fixGroup:true, panel:null, delArm:false, resetArm:false, delClientArm:null, msg:'', pending:null, drill:null, applyAll:true, fixQ:'', limit:120, open:{}};

/* ================= tracking calculations ================= */
const itemPaid = (cat, it) => cat.weekly ? it.w.reduce((a, x) => a + num(x), 0) : num(it.paid);
function catTot(m, cat){ let b = 0, p = 0; (m.cats[cat.id] || []).forEach(it => { b += num(it.budget); p += itemPaid(cat, it); }); return {b, p, l:b - p}; }
const incTot = m => m.income.reduce((a, x) => a + num(x.amount), 0);
function monthTot(m){
  const inc = incTot(m), per = {}, grp = {};
  TRK_EXP.forEach(c => per[c.id] = catTot(m, c));
  TGROUPS_OF().forEach(g => { let b = 0, p = 0; g.cats.forEach(id => { b += per[id].b; p += per[id].p; }); grp[g.id] = {b, p, l:b - p}; });
  const tb = TGROUPS_OF().reduce((a, g) => a + grp[g.id].b, 0), tp = TGROUPS_OF().reduce((a, g) => a + grp[g.id].p, 0);
  return {inc, per, grp, tb, tp, tl:tb - tp, rem:inc - tp};
}
const catSt = (b, p) => (b === 0 && p === 0) ? 'none' : (p > b ? 'over' : 'ok');
const ST_TXT = {none:'אין נתונים', over:'חריגה', ok:'בתוך התקציב'};
function overall(t){
  if (t.inc === 0 && t.tb === 0 && t.tp === 0) return 'טרם הוזנו נתונים';
  if (t.tp > t.inc) return 'גירעון: ההוצאות עולות על ההכנסות';
  if (t.tb > t.inc) return 'התקציב גבוה מההכנסות';
  if (t.tp > t.tb) return 'חריגה מהתקציב';
  if (TRK_EXP.some(c => catSt(t.per[c.id].b, t.per[c.id].p) === 'over')) return 'תקין בסך הכול, אך יש קטגוריות בחריגה';
  return 'מצב תקין';
}
function monthStatus(t){ if (t.inc === 0 && t.tb === 0 && t.tp === 0) return ''; if (t.tp > t.inc) return 'גירעון'; if (t.tp > t.tb) return 'חריגה מתקציב'; return 'תקין'; }

/* ================= statements: parsing ================= */
const iso = (y, m, d) => (m >= 1 && m <= 12 && d >= 1 && d <= 31 && y >= 1990 && y <= 2100) ? y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0') : null;
function parseDate(v){
  if (v instanceof Date && !isNaN(v)) return iso(v.getFullYear(), v.getMonth() + 1, v.getDate());
  if (typeof v === 'number') { if (v > 30000 && v < 80000) { const d = new Date(Math.round((v - 25569) * 86400000)); return iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()); } return null; }
  const s = String(v == null ? '' : v).trim(); if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/); if (m) return iso(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[\/\.\-](\d{1,2})[\/\.\-](\d{2,4})/); if (m) { let y = +m[3]; if (y < 100) y += 2000; return iso(y, +m[2], +m[1]); }
  return null;
}
function numParse(x){
  if (typeof x === 'number') return isFinite(x) ? x : 0;
  let s = String(x == null ? '' : x).trim(); if (!s) return 0;
  const neg = /^\(.*\)$/.test(s) || /^[\s\u200e\u200f]*-/.test(s) || /-\s*$/.test(s) || /^−/.test(s);
  let d = s.replace(/[^\d.,]/g, ''); if (!d) return 0;
  if (/,\d{1,2}$/.test(d) && d.indexOf('.') < 0) d = d.replace(',', '.'); else d = d.replace(/,/g, '');
  const n = parseFloat(d); if (!isFinite(n)) return 0;
  return neg ? -n : n;
}
function parseDelimited(text){
  text = String(text).replace(/^\uFEFF/, '');
  const head = text.split(/\r?\n/).slice(0, 12).join('\n');
  const cnt = ch => (head.match(new RegExp(ch === '\t' ? '\\t' : '\\' + ch, 'g')) || []).length;
  const cands = [[',', cnt(',')], [';', cnt(';')], ['\t', cnt('\t')]].sort((a, b) => b[1] - a[1]);
  const delim = cands[0][1] > 0 ? cands[0][0] : ',';
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === delim) { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cur); cur = ''; if (row.some(x => String(x).trim() !== '')) rows.push(row); row = []; }
    else cur += c;
  }
  row.push(cur); if (row.some(x => String(x).trim() !== '')) rows.push(row);
  return rows;
}
function decodeText(buf){
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  try { return new TextDecoder('utf-8', {fatal:true}).decode(u8); } catch(e) { try { return new TextDecoder('windows-1255').decode(u8); } catch(e2) { return new TextDecoder('utf-8').decode(u8); } }
}
function sheetRows(wsht){
  const X = window.XLSX; if (!X || !wsht || !wsht['!ref']) return [];
  const rg = X.utils.decode_range(wsht['!ref']), out = [];
  for (let r = rg.s.r; r <= rg.e.r; r++) {
    const row = [];
    for (let c = rg.s.c; c <= rg.e.c; c++) {
      const cell = wsht[X.utils.encode_cell({r, c})];
      if (!cell) { row.push(''); continue; }
      if (cell.t === 'n' && cell.z && X.SSF && X.SSF.is_date(cell.z)) { const d = X.SSF.parse_date_code(cell.v); row.push(d ? iso(d.y, d.m, d.d) || '' : ''); }
      else if (cell.t === 'd' && cell.v instanceof Date) row.push(cell.v);
      else if (cell.t === 'n') row.push(cell.v);
      else row.push(String(cell.w != null ? cell.w : (cell.v != null ? cell.v : '')));
    }
    if (row.some(x => String(x).trim() !== '')) out.push(row);
  }
  return out;
}
function readTables(buf, name){
  if (/\.xlsx?$/i.test(name || '')) {
    if (!window.XLSX) throw new Error('xlsx-missing');
    const wb = window.XLSX.read(new Uint8Array(buf), {type:'array'});
    return wb.SheetNames.map(n => ({name:n, rows:sheetRows(wb.Sheets[n])})).filter(t => t.rows.length > 1);
  }
  return [{name:'קובץ', rows:parseDelimited(decodeText(buf))}];
}
const HP = {
  cdate:[/תאריך\s*ה?חיוב/, /חיוב\s*ל?תאריך/], vdate:[/תאריך\s*ערך/],
  date:[/תאריך\s*(עסקה|רכישה|פעולה|התחייבות)/, /^תאריך$/],
  desc:[/שם\s*בית\s*ה?עסק/, /בית\s*ה?עסק/, /שם\s*(ה)?עסק/, /^תיאור/, /תיאור\s*הפעולה/, /^תאור/, /סוג\s*תנועה/, /^תנועה$/, /^ה?פעולה$/, /^פרטים$/],
  amt:[/סכום\s*ה?חיוב/, /סכום\s*בש/, /סכום\s*ה?עסקה/, /^סכום$/, /זכות\s*\/\s*חובה|חובה\s*\/\s*זכות/],
  debit:[/^חובה$/, /בחובה/], credit:[/^זכות$/, /בזכות/],
  extra:[/סוג\s*ה?עסק/], ex2:[/פירוט\s*נוסף/, /^פירוט$/, /הערות/], ic:[/^קטגוריה$/, /^ענף$/],
  card:[/^שם\s*כרטיס$/, /^כרטיס$/, /ספרות\s*אחרונות/, /^מספר\s*כרטיס$/], ref:[/^אסמכתא$/],
  det:[/^פרטים$/], to:[/^לטובת$/], forr:[/^עבור$/], cur:[/מטבע\s*(עסקה\s*)?מקורי/, /^מטבע\s*ה?עסקה$/, /^מטבע$/], pa:[/^סכום\s*קנייה$/, /^סכום\s*רכישה$/, /^סכום\s*ה?עסקה$/]
};
const hnorm = v => String(v == null ? '' : v).replace(/["'׳״\u200e\u200f]/g, '').replace(/\s+/g, ' ').trim();
function mapRow(row){
  const map = {}, hs = row.map(hnorm);
  Object.keys(HP).forEach(role => { for (const re of HP[role]) { const i = hs.findIndex((h, ci) => h && re.test(h) && !Object.values(map).includes(ci)); if (i >= 0) { map[role] = i; break; } } });
  if (map.date == null && map.vdate != null) map.date = map.vdate;
  return map;
}
function detectMapping(rows){
  let best = null;
  for (let r = 0; r < Math.min(rows.length, 40); r++) {
    const map = mapRow(rows[r]);
    const ok = map.date != null && map.desc != null && (map.amt != null || map.debit != null || map.credit != null);
    const score = Object.keys(map).length;
    if (ok && (!best || score > best.score)) best = {hdr:r, map, score};
  }
  return best;
}
const SETTLE_RE = /מסטרקארד|מסטרקרד|מסטר\s*קארד|מאסטרקארד|mastercard|ישראכרט|isracard|\bcal\b|כאל|כרטיסי אשראי|כ\.א\.ל|מקס|\bmax\b|לאומי קארד|ויזה|visa|דיינרס|diners|אמריקן|amex|חיוב כרטיס|כרטיס אשראי/i;
const isHeaderRow = row => { const m = mapRow(row); return m.date != null && m.desc != null && (m.amt != null || m.debit != null || m.credit != null); };
function nextHeader(rows, from){ for (let r = from + 1; r < rows.length; r++) if (isHeaderRow(rows[r])) return r; return -1; }
const FOREIGN_AMT = /דולר|יורו|אירו|usd|eur|\$|€/i;
const cleanDetail = s => String(s == null ? '' : s).replace(/(המבצע|לטובת|עבור)\s*:/g, '').replace(/\d{6,}/g, '').replace(/\s+/g, ' ').trim();
const last4 = v => { const d = String(v == null ? '' : v).replace(/\.0+$/, '').replace(/\D/g, ''); return d ? d.slice(-4) : ''; };
function normalizeOne(tbl, hdr, map, type, sign, end){
  const out = [];
  if (map.amt != null && FOREIGN_AMT.test(hnorm(tbl.rows[hdr][map.amt]))) return out;
  for (let r = hdr + 1; r < end; r++) {
    const row = tbl.rows[r], at = i => (i == null ? '' : row[i]);
    const date = parseDate(at(map.date)) || (map.vdate != null ? parseDate(at(map.vdate)) : null); if (!date) continue;
    let desc = String(at(map.desc) == null ? '' : at(map.desc)).replace(/\s+/g, ' ').trim();
    const det = [map.det, map.to, map.forr].map(i => cleanDetail(at(i))).filter(Boolean).join(' · ');
    if (type === 'bank' && det) desc = (desc ? desc + ' – ' : '') + det;
    if (!desc) desc = '(ללא פירוט)';
    let amt, kind;
    if (map.debit != null || map.credit != null) {
      const d = numParse(at(map.debit)), c = numParse(at(map.credit));
      if (d > 0) { kind = 'exp'; amt = d; } else if (c > 0) { kind = 'inc'; amt = c; } else if (d < 0) { kind = 'inc'; amt = -d; } else if (c < 0) { kind = 'exp'; amt = -c; } else continue;
    } else {
      const a = numParse(at(map.amt)); if (a === 0) continue;
      if (type === 'card') { kind = 'exp'; amt = a; }
      else { const isExp = sign === 'neg' ? a < 0 : a > 0; kind = isExp ? 'exp' : 'inc'; amt = Math.abs(a); }
    }
    out.push({date, cd:map.cdate != null ? parseDate(at(map.cdate)) : null, desc, amt:r2(amt), kind, ex:[map.extra, map.ex2].map(i => i == null || at(i) == null ? '' : String(at(i))).filter(Boolean).join(' ').replace(/\s+/g, ' ').trim(), ic:map.ic != null ? String(at(map.ic) == null ? '' : at(map.ic)).trim() : '',
              card: type === 'card' ? last4(at(map.card)) : (map.ref != null ? last4(at(map.ref)) : ''), fx: type === 'card' && map.cur != null && !!String(at(map.cur) == null ? '' : at(map.cur)).trim() && !/ש"?ח|שח|ils|nis|₪|שקל/i.test(String(at(map.cur))), pa: (type === 'card' && map.pa != null) ? Math.abs(numParse(at(map.pa))) : 0});
  }
  return out;
}
/* a sheet may hold several tables (domestic / abroad ...): the chosen one uses the confirmed mapping, the rest are detected automatically */
function normalizeTable(tbl, hdr, map, type, sign, all){
  const starts = [hdr]; let n;
  if (all) while ((n = nextHeader(tbl.rows, starts[starts.length - 1])) > 0) starts.push(n);
  let out = [];
  starts.forEach((s, i) => { const end = nextHeader(tbl.rows, s); out = out.concat(normalizeOne(tbl, s, i === 0 ? map : mapRow(tbl.rows[s]), type, sign, end < 0 ? tbl.rows.length : end)); });
  return out;
}
function countTables(tbl, hdr){ let c = 1, n, last = hdr; while ((n = nextHeader(tbl.rows, last)) > 0) { c++; last = n; } return c; }

/* ================= categorisation ================= */
const SUBLIST = {
  inc:['משכורת','קצבאות','ריבית ודיבידנדים','העברות והכנסות אחרות'],
  hou:['משכנתא','שכר דירה','חשמל (חודשי)','מים (חודשי)','ארנונה (חודשי)','גז','אינטרנט','טלפון','כבלים','וועד','אבטחה'],
  sub:['נטפליקס','ספוטיפיי','apple','google','chat gpt','תרומות','מנויים אחרים'],
  trn:['דלק / חשמל','חניה','כביש 6','תחבורה ציבורית','מוניות וקורקינטים'],
  med:['קופת חולים','תרופות','פסיכולוג','טיפול רגשי','שיניים'],
  ins:['ביטוח דירה','ביטוח חיים','ביטוח רכב','ביטוח בריאות','תאונות אישיות'],
  dea:[],
  sto:['חופשה שנתית','טיפול רכב','טסט','שמחות ואירועים','ימי הולדת','אירוח בחגים','חיסכון'],
  loa:['קרן ההלוואה','ריבית ההלוואה'],
  var:['מזון ומכולת','בילוי ומסעדות','ביגוד והנעלה','תחזוקת בית','מספרה','קוסמטיקה','רכישות ברשת','פארם'],
  oth:['עמלות בנק'],
  cash:[], apps:[], trf:[], abr:[]
};
const DICT = [
  ['apps', ['בbit','ב bit','bit ','bit-',' ביט','ביט ','ביט-','paybox','פייבוקס','פיי בוקס']],
  ['cash', ['משיכת מזומן','משיכה מבנקט','משיכת מזומנים','משיכה מכספומט','כספומט','בנקט','atm ','משיכה במזומן']],
  ['loa/ריבית ההלוואה', ['הלו\' רבית','הלו׳ רבית','ריבית הלוואה','רבית הלוואה']],
  ['loa/קרן ההלוואה', ['הלוואה קרן','הלואה קרן','הלו\' קרן','החזר הלוואה']],
  ['loa', ['הלוואה','הלוואת','הלואה','הלו\'','הלו׳']],
  ['trf', ['העב\' לאחר','העב׳ לאחר','העברה לחשבון','העברה-נייד','העברה נייד','העברה מקוונת','העברה בנקאית','העברת כספים','העברה','העב\'','העב׳']],
  ['sto/חיסכון', ['חיסכון','חסכון','פיקדון','קרן השתלמות','קופת גמל','קרן פנסיה','הפקדה לפנסיה']],
  ['ins/ביטוח דירה', ['ביטוח דירה','ביטוח מבנה','ביטוח תכולה']],
  ['ins/ביטוח חיים', ['ביטוח חיים','ריסק']],
  ['ins/ביטוח רכב', ['ביטוח רכב','שירביט','ביטוח ישיר','ביטוח חובה']],
  ['ins/ביטוח בריאות', ['ביטוח בריאות','ביטוח משלים','ביטוח סיעודי']],
  ['ins', ['ביטוח','הראל','הפניקס','מנורה','ליברה','הכשרה','9 מיליון','aig','איילון']],
  ['med/קופת חולים', ['מכבי','כללית','מאוחדת','לאומית שירות','קופת חולים']],
  ['med/שיניים', ['שיניים','אורתודנט']],
  ['med/פסיכולוג', ['פסיכולוג']],
  ['med/תרופות', ['בית מרקחת','תרופות']],
  ['med', ['מרפאה','רופא','אופטיק','פיזיותרפ','מעבדה','מכון רפואי','רפואי']],
  ['hou/חשמל (חודשי)', ['חברת החשמל','חשמל']],
  ['hou/מים (חודשי)', ['תאגיד','מקורות','מי אביבים','מי גבעתיים','מי רעננה','מי שבע','מי הרצליה','מי כרמל','מי עירון','מי ציונה','מי חדרה','תאגיד מים']],
  ['hou/ארנונה (חודשי)', ['ארנונה','עיריית','עירייה']],
  ['hou/גז', ['סופרגז','אמישראגז','פזגז','גז ']],
  ['hou/טלפון', ['פלאפון','סלקום','פרטנר','גולן טלקום','019','אקספון','הוט מובייל','hot mobile']],
  ['hou/אינטרנט', ['בזק','אינטרנט','הוט נט','hot net']],
  ['hou/כבלים', ['הוט ','כבלים','yes טלוויזיה']],
  ['hou/וועד', ['ועד בית','וועד בית']],
  ['hou/שכר דירה', ['שכר דירה','שכ"ד','שכירות']],
  ['hou/משכנתא', ['משכנתא','משכנתה']],
  ['sub/נטפליקס', ['netflix','נטפליקס']],
  ['sub/ספוטיפיי', ['spotify','ספוטיפיי']],
  ['sub/apple', ['apple.com','apple services','itunes']],
  ['sub/chat gpt', ['chatgpt','openai']],
  ['sub/google', ['google','youtube']],
  ['sub/תרומות', ['תרומה','עמותה']],
  ['sub/מנויים אחרים', ['disney','prime video','amazon prime','hbo','microsoft','adobe','dropbox','icloud','canva','zoom','linkedin','audible','storytel','מנוי']],
  ['trn/מוניות וקורקינטים', ['gett','גט טקסי','uber','bolt','yellow','bird*','lime*']],
  ['trn/דלק / חשמל', ['פז ','פז-','סונול','דור אלון','דלק','אלונית']],
  ['trn/חניה', ['חניה','פנגו','pango','סלופארק','cellopark','אחוזות החוף']],
  ['trn/כביש 6', ['כביש 6','דרך ארץ','נתיבי איילון','מנהרות הכרמל','אגרה']],
  ['trn/תחבורה ציבורית', ['רב קו','רב-קו','רכבת ישראל','רכבת','אגד','מטרופולין','קווים','סופרבוס']],
  ['sto/חופשה שנתית', ['אל על','ארקיע','ישראייר','ryanair','wizz','easyjet','booking','airbnb','expedia','agoda','מלון','tripadvisor']],
  ['sto/טסט', ['טסט','משרד הרישוי','רישוי']],
  ['sto/טיפול רכב', ['מוסך','צמיג','אוטו דפו']],
  ['oth/עמלות בנק', ['עמלה','עמלת','דמי כרטיס','דמי ניהול','ontime','ע.מפעולות','עמ\' עוש','עמ׳ עוש']],
  ['var/פארם', ['סופר פארם','סופר-פארם','super-pharm','be ','ניו פארם','newpharm','פארם']],
  ['var/קוסמטיקה', ['קוסמטיקה','ספא','מניקור']],
  ['var/מספרה', ['מספרה']],
  ['var/ביגוד והנעלה', ['זארה','zara','h&m','קסטרו','פוקס','גולף','שילב','טרמינל','ביגוד','נעלי','הנעלה']],
  ['var/רכישות ברשת', ['aliexpress','amazon','shein','temu','ebay','ksp','באג','זאפ','עלי אקספרס','אמזון']],
  ['var/תחזוקת בית', ['הום סנטר','איקאה','ikea','טמבור']],
  ['var/בילוי ומסעדות', ['מסעדה','קפה','ארומה','גרג','לנדוור','coffee','מקדונלד','בורגר','דומינו','פיצה','וולט','wolt','תן ביס','10bis','סושי','שווארמה','פלאפל','גלידה','פאב','סינמה','yes planet','יס פלאנט','קולנוע','תיאטרון','eventim','כרטיסים']],
  ['var/מזון ומכולת', ['שופרסל','רמי לוי','ויקטורי','יוחננוף','מגה ','טיב טעם','אושר עד','חצי חינם','מינימרקט','מיני מרקט','am:pm','איי אם פי אם','ampm','פרש מרקט','סטופ מרקט','קשת טעמים','מאפיית','מאפיה','מאפייה','קצביה','סופר ','סופר-']],
  ['var', ['קניון','סטימצקי','צומת ספרים']]
];
const INCDICT = [
  ['inc/משכורת', ['משכורת','שכר','פנסיה','תשלום ממעסיק']],
  ['inc/קצבאות', ['ביטוח לאומי','בטוח לאומי','קצבה','קצבת','גמלה','מענק']],
  ['inc/ריבית ודיבידנדים', ['דיבידנד','רבית','ריבית']]
];
const ICMAP = [
  [/מזון|סופר|מסעד|קפה|בילוי|פנאי|אופנה|ביגוד|קניות|ספורט|בית וגן|ריהוט|מוצרי חשמל|תרבות/, 'var'],
  [/תחבורה|דלק|רכב|חניה|נסיעות/, 'trn'], [/בריאות|רפואה|קוסמטיקה/, 'med'], [/ביטוח/, 'ins'], [/תקשורת|חשמל|מים|ארנונה|גז/, 'hou'], [/תיירות|טיסות|מלונות/, 'sto']
];
function mkey(desc, type){
  let s = String(desc).toLowerCase().replace(/[0-9\u0660-\u0669]+/g, ' ').replace(/[\*\-_\/\\.,:;"'׳״()#&+]/g, ' ').replace(/\s+/g, ' ').trim();
  return s.split(' ').filter(Boolean).slice(0, type === 'bank' ? 5 : 2).join(' ');
}
function autoCat(t, rules){
  const r = rules[t.rk]; if (r) return r;
  const dl = (t.desc + ' ' + t.ex).toLowerCase();
  if (t.kind === 'inc') { for (const [cat, words] of INCDICT) for (const w of words) if (dl.indexOf(w) >= 0) return cat; return 'inc/העברות והכנסות אחרות'; }
  if (t.settle) return 'uns';
  if (t.inst) return 'dea/' + t.desc.slice(0, 30);
  if (t.fx) { for (const [cat, words] of DICT) if (cat.startsWith('sub')) for (const w of words) if (dl.indexOf(w) >= 0) return cat; return 'abr'; }
  for (const [cat, words] of DICT) for (const w of words) if (dl.indexOf(w) >= 0) return cat;
  if (t.ic) for (const [re, cat] of ICMAP) if (re.test(t.ic)) return cat;
  return 'uns';
}
const INC_RE = /משכורת|שכר|קצבה|קצבת|ביטוח לאומי|בטוח לאומי|דיבידנד|החזר מס|מענק|פנסיה|גמלה|תשלום ממעסיק|הכנסה/;
const catStr = t => t.out ? 'skip' : (t.man ? t.cat : (t.x ? 'skip' : t.ac));
const catOf = t => String(catStr(t)).split('/')[0];
const subOf = t => { const s = String(catStr(t)); const i = s.indexOf('/'); return i < 0 ? '' : s.slice(i + 1); };
function buildTx(raw, src, type){
  let inst = false;
  const m = payOf(raw.desc + ' ' + raw.ex);
  if (m && m[1] > 1) inst = true; else if (/תשלומים/.test(raw.ex) && !/הוראת קבע/.test(raw.ex)) inst = true;
  const key = mkey(raw.desc, type);
  const settle = type === 'bank' && raw.kind === 'exp' && SETTLE_RE.test(raw.desc), named = settle && raw.desc.match(/(?:^|\D)(\d{4})(?:\D|$)/);
  return {id:uid(), src, type, date:raw.date, cd:raw.cd, desc:raw.desc, amt:raw.amt, kind:raw.kind, ex:raw.ex.slice(0, 60), ic:raw.ic.slice(0, 30), key, rk:raw.kind + '|' + key, card:raw.card || (named ? named[1] : ''), pa:raw.pa || 0, fx:!!raw.fx,
          settle, inst, ac:'uns', man:false, cat:null, x:null};
}
/* cross-check of credit-card settlements in the bank account against card statements */
let crossRes = {matched:[], unmatched:[], near:[], covered:[], groups:[], cardUnmatched:[], covGaps:[]};
function crossCheck(rep){
  const oldGap = {}; rep.tx.forEach(t => { if (t.virt && t.man) oldGap[t.id] = t.cat; });
  rep.tx = rep.tx.filter(t => !t.virt);
  rep.tx.forEach(t => { t.x = null; delete t.gap; delete t.out; });
  // The report covers the bank statement's months. Card purchases outside them stay out of the report: the
  // next month's statement adds the last month's purchases, and its own new purchases are not part of the period.
  const bankDates = rep.tx.filter(t => t.type === 'bank').map(t => t.date).sort();
  const period = bankDates.length ? {from:bankDates[0].slice(0, 7), to:bankDates[bankDates.length - 1].slice(0, 7)} : null;
  rep.period = period;
  rep.cdCards = {};
  if (period) { const ks = new Set(rep.tx.filter(t => t.type === 'card' && t.cd).map(t => t.card || ''));
    ks.forEach(k => { if (!rep.tx.some(t => t.type === 'card' && (t.card || '') === k && t.cd && t.cd.slice(0, 7) > period.to)) rep.cdCards[k] = true; }); }
  if (period) rep.tx.forEach(t => { if (t.type !== 'card') return; const mk = monthOfTx(t, rep); if (mk < period.from || mk > period.to) t.out = mk > period.to ? 'after' : 'before'; });
  const groups = {}, cards = rep.tx.filter(t => t.type === 'card'), cardIds = new Set(cards.map(t => t.card).filter(Boolean));
  cards.forEach(t => { const k = (t.card || '') + '|' + (t.cd || ''); const g = groups[k] || (groups[k] = {k, src:t.src, card:t.card || '', cd:t.cd, sum:0, n:0, matched:false}); g.sum += (t.kind === 'exp' ? t.amt : -t.amt); g.n++; });
  const gl = Object.values(groups).map(g => { g.sum = r2(g.sum); return g; });
  const settles = rep.tx.filter(t => t.type === 'bank' && t.kind === 'exp' && t.settle).sort((a, b) => a.date < b.date ? -1 : 1);
  const dd = (a, b) => Math.abs((Date.parse(a) - Date.parse(b)) / 864e5);
  const sameCard = (g, s) => !g.card || !s.card || !cardIds.has(s.card) || g.card === s.card;
  const near12 = (g, s) => !g.cd || dd(g.cd, s.date) <= 12;
  const anyCd = cards.some(t => t.cd), cDates = cards.map(t => t.date).sort();
  const covered = s => anyCd ? gl.some(g => !g.matched && g.cd && dd(g.cd, s.date) <= 12 && sameCard(g, s))
                             : (cDates.length && s.date >= cDates[0] && dd(s.date, cDates[cDates.length - 1]) <= 45 || (cDates.length && s.date >= cDates[cDates.length - 1] && dd(s.date, cDates[cDates.length - 1]) <= 45));
  const res = {matched:[], unmatched:[], near:[], covered:[], groups:gl, cardUnmatched:[], covGaps:[]};
  // Exact matches first for every charge, so a nearby charge never takes another one's statement as a "near" match.
  const open = new Set(settles);
  for (const s of settles) {
    let best = null;
    for (const g of gl) { if (g.matched || Math.abs(g.sum - s.amt) > 1.01 || !sameCard(g, s) || !near12(g, s)) continue; const dist = g.cd ? dd(g.cd, s.date) : 0; if (!best || dist < best.dist) best = {g, dist}; }
    if (best) { best.g.matched = true; s.x = best.g.k; res.matched.push({s, g:best.g}); open.delete(s); }
  }
  for (const s of [...open]) {
    let pair = null;
    for (let i = 0; i < gl.length && !pair; i++) { if (gl[i].matched) continue; for (let j = i + 1; j < gl.length; j++) { if (gl[j].matched) continue; if (Math.abs(gl[i].sum + gl[j].sum - s.amt) <= 1.01 && [gl[i], gl[j]].every(g => sameCard(g, s) && near12(g, s))) { pair = [gl[i], gl[j]]; break; } } }
    if (pair) { pair.forEach(g => { g.matched = true; }); s.x = pair.map(g => g.k).join('+'); res.matched.push({s, g:pair[0]}); open.delete(s); }
  }
  for (const s of [...open]) {
    const near = gl.filter(g => !g.matched && sameCard(g, s) && near12(g, s)).map(g => ({g, diff:r2(s.amt - g.sum)})).filter(x => Math.abs(x.diff) > 1.01 && Math.abs(x.diff) <= Math.max(300, s.amt * 0.06)).sort((a, b) => Math.abs(a.diff) - Math.abs(b.diff))[0];
    if (near) { near.g.matched = true; s.x = near.g.k; s.gap = near.diff; res.near.push({s, g:near.g, diff:near.diff}); open.delete(s); }
  }
  // "covered": no statement matches by amount, but card details of that period are still unaccounted for
  for (const s of open) { if (covered(s)) { s.x = 'covered'; res.covered.push(s); } else res.unmatched.push(s); }
  res.matched.sort((a, b) => a.s.date < b.s.date ? -1 : 1);
  res.cardUnmatched = gl.filter(g => !g.matched);
  // Charges "covered" by a statement of the same period are only skipped as far as the card details account
  // for them: per month, whatever the bank charged beyond the unmatched card details stays in the report.
  const buckets = {};
  res.covered.forEach(s => { const b = buckets[s.date.slice(0, 7)] || (buckets[s.date.slice(0, 7)] = {mk:s.date.slice(0, 7), bank:0, card:0, s:[]}); b.bank += s.amt; b.s.push(s); });
  res.cardUnmatched.forEach(g => {
    let best = null;
    res.covered.forEach(s => { if (!sameCard(g, s)) return; const dist = g.cd ? dd(g.cd, s.date) : 0; if (g.cd && dist > 12) return; if (!best || dist < best.dist) best = {s, dist}; });
    if (best) buckets[best.s.date.slice(0, 7)].card += g.sum;
  });
  res.covGaps = Object.values(buckets).map(b => ({mk:b.mk, bank:r2(b.bank), card:r2(b.card), gap:r2(b.bank - b.card), s:b.s})).filter(b => b.gap > 1.01).sort((a, b) => a.mk < b.mk ? -1 : 1);
  res.covGaps.forEach(b => { const id = 'cov' + b.mk, cat = oldGap[id], last = b.s[b.s.length - 1];
    rep.tx.push({id, virt:true, src:last.src, type:'bank', date:last.date, cd:'', desc:'פער הצלבה: חיובי אשראי ' + b.mk.split('-').reverse().join('/') + ' ללא פירוט מלא', amt:b.gap, kind:'exp', ex:'', ic:'', key:'', rk:'gap|' + id, card:'', pa:0, fx:false, settle:false, inst:false, ac:'uns', man:cat != null, cat:cat == null ? null : cat, x:null}); });
  // the gap between a bank charge and its card statement is real money: it stays in the report as its own row
  res.near.forEach(({s, diff}) => { const id = s.id + 'g', cat = oldGap[id];
    rep.tx.push({id, virt:true, src:s.src, type:'bank', date:s.date, cd:'', desc:'פער הצלבה: ' + s.desc, amt:Math.abs(diff), kind:diff > 0 ? 'exp' : 'inc', ex:'', ic:'', key:'', rk:'gap|' + id, card:'', pa:0, fx:false, settle:false, inst:false, ac:'uns', man:cat != null, cat:cat == null ? null : cat, x:null}); });
  crossRes = res; return res;
}

function recomputeAll(){
  applyClientCats(cl());
  const rep = cl().rep;
  rep.tx.forEach(t => { t.ac = autoCat(t, rep.rules); });
  crossCheck(rep);
}
// the same installment (same purchase date, shop and amount) appears in every month's statement with its own charge date
const txKey = (t, type) => [t.date, t.desc, t.amt, t.kind, type].join('|') + (t.cd ? '|' + t.cd : '');
function importRaw(rawList, type, name, fileName){
  const rep = cl().rep;
  const src = {id:uid(), name:name, type, file:fileName || '', n:0, total:0, from:null, to:null};
  const have = {}; rep.tx.forEach(t => { if (t.virt) return; const k = txKey(t, t.type); have[k] = (have[k] || 0) + 1; });
  Object.keys(rep.del || {}).forEach(k => { have[k] = (have[k] || 0) + rep.del[k]; });
  const seen = {}; let dupes = 0; const add = [];
  rawList.forEach(raw => {
    const k = txKey(raw, type); seen[k] = (seen[k] || 0) + 1;
    if (seen[k] <= (have[k] || 0)) { dupes++; return; }
    add.push(buildTx(raw, src.id, type));
  });
  add.forEach(t => { src.n++; src.total += t.kind === 'exp' ? t.amt : -t.amt; if (!src.from || t.date < src.from) src.from = t.date; if (!src.to || t.date > src.to) src.to = t.date; });
  src.total = r2(src.total);
  src.dup = dupes;
  rep.sources.push(src); rep.tx.push(...add); rep.dupes = (rep.dupes || 0) + dupes;
  recomputeAll(); persist();
  return {added:add.length, dupes, src};
}
function setRule(rk, cat){
  const rep = cl().rep; rep.rules[rk] = cat;
  rep.tx.forEach(t => { if (t.rk === rk) { t.man = false; t.cat = null; } });
  recomputeAll(); persist();
}
function assignTx(id, cat){
  const rep = cl().rep, t = rep.tx.find(x => x.id === id); if (!t) return;
  if (ui.applyAll) { setRule(t.rk, cat); return; }
  t.man = true; t.cat = cat; persist();
}
function markOnce(id, on){
  const rep = cl().rep, t = rep.tx.find(x => x.id === id); if (!t) return;
  if (on) { t.was = {man:t.man, cat:t.cat}; t.man = true; t.cat = 'once'; }
  else { const w = t.was || {man:false, cat:null}; t.man = w.man; t.cat = w.cat; delete t.was; }
  persist();
}
function deleteTx(id){
  const rep = cl().rep, t = rep.tx.find(x => x.id === id); if (!t || t.virt) return;
  const k = txKey(t, t.type); rep.del = rep.del || {}; rep.del[k] = (rep.del[k] || 0) + 1;
  rep.tx = rep.tx.filter(x => x.id !== id); recomputeAll(); persist();
}
function deleteSource(id){ const rep = cl().rep; rep.sources = rep.sources.filter(s => s.id !== id); rep.tx = rep.tx.filter(t => t.src !== id); recomputeAll(); persist(); }

/* ================= installments ================= */
const PAYRE = /(?:תשלום\s*(\d+)\s*(?:מתוך|\/)\s*(\d+))|(?:^|\s)(\d+)\s*מ\s*-\s*(\d+)(?:\s|$)/;
const payOf = str => { const m = String(str).match(PAYRE); return m ? (m[1] ? [+m[1], +m[2]] : [+m[3], +m[4]]) : null; };
let instMap = {};
function buildInstallments(){
  const rep = cl().rep, groups = {}; instMap = {};
  rep.tx.filter(t => t.inst && t.type === 'card' && t.kind === 'exp').forEach(t => { const k = t.desc + '|' + t.date + '|' + t.pa; (groups[k] = groups[k] || []).push(t); });
  const now = new Date(), curKey = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
  const addM = (iso, n) => { const [y, m] = iso.split('-').map(Number); const d = new Date(y, m - 1 + n, 1); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); };
  const list = Object.values(groups).map(items => {
    items.sort((a, b) => (a.cd || a.date) < (b.cd || b.date) ? -1 : 1);
    const first = items[0], last = items[items.length - 1], amt = last.amt, pa = first.pa || 0;
    let n = items.length, N = null, explicit = false;
    const m = items.map(t => payOf(t.desc + ' ' + t.ex)).filter(Boolean).pop();
    if (m) { n = m[0]; N = m[1]; explicit = true; }
    else if (pa > 0 && amt > 0) N = Math.max(2, Math.round(pa / amt));
    const paid = items.reduce((a, t) => a + t.amt, 0);
    const remaining = N ? Math.max(0, N - n) : null;
    const remAmt = N ? (pa > paid ? pa - paid : remaining * amt) : null;
    const lastKey = (last.cd || last.date).slice(0, 7), endKey = remaining === null ? null : addM(lastKey + '-01', remaining);
    const active = remaining !== null && remaining > 0 && endKey >= curKey;
    items.forEach((t, i) => { instMap[t.id] = {n:explicit ? n : i + 1, N}; });
    return {desc:first.desc, date:first.date, pa, amt, n, N, explicit, remaining, remAmt, endKey, active, done:remaining === 0 || (remaining > 0 && endKey < curKey), paid};
  }).sort((a, b) => (b.active - a.active) || (a.endKey || '') .localeCompare(b.endKey || ''));
  return {list, monthly:list.filter(x => x.active).reduce((a, x) => a + x.amt, 0), remTotal:list.filter(x => x.active).reduce((a, x) => a + (x.remAmt || 0), 0)};
}
function onceHTML(){
  const list = cl().rep.tx.filter(t => catOf(t) === 'once').sort((a, b) => a.date < b.date ? 1 : -1);
  if (!list.length) return `<p class="small noprint" style="margin:0 0 14px">הוצאה או העברה חד פעמית אפשר להוציא מהחישוב ומהממוצע בלחיצה על ״חד פעמי״ ליד שורת החיוב (בלחיצה על סכום בדוח).</p>`;
  const dF = s => s.split('-').reverse().join('/');
  const exp = list.filter(t => t.kind === 'exp').reduce((a, t) => a + t.amt, 0), inc = list.filter(t => t.kind === 'inc').reduce((a, t) => a + t.amt, 0);
  const rows = list.map(t => `<tr><td>${esc(dF(t.date))}</td><td>${esc(t.desc)}</td><td><span class="badge st-none">${t.kind === 'inc' ? 'הכנסה' : 'הוצאה'}</span></td><td><span class="num">${fmt(t.amt)}</span></td><td><button class="btn ghost" data-act="unonce" data-t="${t.id}">החזרה לחישוב</button></td></tr>`).join('');
  return `<div class="card" style="margin-bottom:14px"><h2>חד פעמיות: לא נכללו בחישוב ובממוצע</h2><div class="scroll"><table class="tbl"><thead><tr><th>תאריך</th><th>תיאור</th><th>סוג</th><th>סכום</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
    <div class="pad small">סה״כ הוצאות חד פעמיות: <b class="num">${fmt(exp)}</b>${inc ? ` · הכנסות חד פעמיות: <b class="num">${fmt(inc)}</b>` : ''}</div></div>`;
}
function installmentsHTML(){
  const I = buildInstallments();
  if (!I.list.length) return `<div class="card" style="margin-bottom:14px"><h2>עסקאות בתשלומים</h2><div class="pad small">לא נמצאו עסקאות בתשלומים בתדפיסים שנטענו.</div></div>`;
  const dF = s => s.split('-').reverse().join('/');
  const rows = I.list.map(x => `<tr><td>${esc(x.desc)}</td><td>${esc(dF(x.date))}</td><td><span class="num">${x.pa ? fmt(x.pa) : '–'}</span></td><td><span class="num">${fmt(x.amt)}</span></td><td>${x.N ? `${x.n} מתוך ${x.N}` : `${x.n} (סה״כ לא ידוע)`}${x.explicit ? '' : ' <span class="small">(אומדן)</span>'}</td><td>${x.remaining === null ? '–' : x.remaining}</td><td><span class="num">${x.remAmt === null ? '–' : fmt(x.remAmt, true)}</span></td><td>${x.endKey ? esc(mShort(x.endKey)) : '–'}</td><td><span class="badge ${x.active ? 'st-ok' : 'st-none'}">${x.active ? 'פעילה' : (x.remaining === 0 ? 'הסתיימה' : 'אמורה להסתיים')}</span></td></tr>`).join('');
  return `<div class="card" style="margin-bottom:14px"><h2>עסקאות בתשלומים: כמה נשאר ומתי זה מסתיים</h2><div class="scroll"><table class="tbl"><thead><tr><th>בית עסק</th><th>תאריך העסקה</th><th>סכום העסקה</th><th>תשלום חודשי</th><th>תשלום</th><th>נשארו</th><th>יתרה לתשלום</th><th>מסתיים</th><th>סטטוס</th></tr></thead><tbody>${rows}
    <tr class="t"><td colspan="3">סה״כ עסקאות פעילות</td><td><b class="num">${fmt(I.monthly, true)}</b> לחודש</td><td colspan="2"></td><td><b class="num">${fmt(I.remTotal, true)}</b></td><td colspan="2"></td></tr></tbody></table></div>
    <div class="pad small">מספר התשלומים הכולל נלקח מהתדפיס כשהוא מופיע. כשהוא לא מופיע הוא מחושב כסכום העסקה חלקי התשלום החודשי (אומדן), וכדאי לאמת מול הלקוח.</div></div>`;
}

/* ================= the report ================= */
// A card whose statement of the month after the period was not loaded is counted by charge month: otherwise the
// period's last month would miss its purchases (they sit in that missing statement).
function monthOfTx(t, rep){ const d = (t.type === 'card' && t.cd && (rep.cardBy === 'cd' || t.inst || (rep.cdCards && rep.cdCards[t.card || '']))) ? t.cd : t.date; return d.slice(0, 7); }
function buildReport(){
  applyClientCats(cl());
  const rep = cl().rep, M = {}, SM = {}, keys = new Set();
  let minD = null, maxD = null;
  rep.tx.forEach(t => {
    const c = catOf(t); if (c === 'skip' || c === 'once') return;
    const mk = monthOfTx(t, rep); keys.add(mk);
    if (!minD || t.date < minD) minD = t.date; if (!maxD || t.date > maxD) maxD = t.date;
    const sub = subOf(t); if (c !== 'uns') { const sk = c + '/' + sub; (SM[mk] = SM[mk] || {})[sk] = ((SM[mk] || {})[sk] || 0) + (c === 'inc' ? (t.kind === 'inc' ? t.amt : -t.amt) : (t.kind === 'exp' ? t.amt : -t.amt)); }
    const row = M[mk] || (M[mk] = {}); let key = c, v = c === 'inc' ? (t.kind === 'inc' ? t.amt : -t.amt) : (t.kind === 'exp' ? t.amt : -t.amt);
    if (c === 'uns' && t.kind === 'inc') { key = 'unsInc'; v = t.amt; }
    row[key] = (row[key] || 0) + v;
  });
  const ks = [...keys].sort();
  const months = ks.map((k, i) => {
    let partial = false;
    if (i === 0 && minD && +minD.slice(8) > 7 && minD.slice(0, 7) === k) partial = true;
    if (i === ks.length - 1 && maxD && maxD.slice(0, 7) === k) { const [y, m] = k.split('-'); const dim = new Date(+y, +m, 0).getDate(); if (+maxD.slice(8) < dim - 6) partial = true; }
    const incl = rep.excl[k] !== undefined ? !rep.excl[k] : !partial;
    return {k, partial, incl};
  });
  if (months.length && !months.some(m => m.incl) && !Object.keys(rep.excl).length) months.forEach(m => { m.incl = true; });
  const catList = EXP.map(c => c.id).concat(['uns']);
  const total = mk => catList.reduce((a, c) => a + ((M[mk] || {})[c] || 0), 0);
  const income = mk => (M[mk] || {}).inc || 0;
  const inc = months.filter(m => m.incl), n = inc.length || 1;
  const avg = c => inc.reduce((a, m) => a + ((M[m.k] || {})[c] || 0), 0) / n;
  const avgExp = inc.reduce((a, m) => a + total(m.k), 0) / n;
  const avgInc = inc.reduce((a, m) => a + income(m.k), 0) / n;
  const subKeys = {}; Object.keys(SM).forEach(mk => Object.keys(SM[mk]).forEach(k => { const [c, ...r] = k.split('/'); const s = r.join('/'); (subKeys[c] = subKeys[c] || new Set()).add(s); }));
  const subs = {}; Object.keys(subKeys).forEach(c => { subs[c] = [...subKeys[c]].sort((a, b) => months.reduce((x, m) => x + Math.abs((SM[m.k] || {})[c + '/' + b] || 0), 0) - months.reduce((x, m) => x + Math.abs((SM[m.k] || {})[c + '/' + a] || 0), 0)); });
  const avgSub = k => inc.reduce((a, m) => a + ((SM[m.k] || {})[k] || 0), 0) / n;
  return {M, SM, subs, avgSub, months, catList, total, income, avg, avgExp, avgInc, nIncl:inc.length, from:minD, to:maxD};
}

/* ================= views: shared pieces ================= */
const subsOf = id => { const own = ((cl().extraSubs || {})[id] || []); return (SUBLIST[id] || []).concat(own.filter(x => !(SUBLIST[id] || []).includes(x))); };
function addClientSub(id, name){
  const c = cl(); name = String(name || '').replace(/[\/›]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40);
  if (!BY[id] || !name) return 'צריך לבחור קטגוריה ולכתוב שם לשורה.';
  c.extraSubs = c.extraSubs || {}; const l = c.extraSubs[id] = c.extraSubs[id] || [];
  if (!subsOf(id).includes(name)) l.push(name);
  const dl = document.getElementById('catDL'); if (dl) dl.remove(); persist(); return '';
}
function delClientSub(id, name){
  const c = cl(), rep = c.rep, key = id + '/' + name;
  if (c.extraSubs && c.extraSubs[id]) c.extraSubs[id] = c.extraSubs[id].filter(x => x !== name);
  rep.tx.forEach(t => { if (t.man && t.cat === key) t.cat = id; });
  Object.keys(rep.rules || {}).forEach(k => { if (rep.rules[k] === key) rep.rules[k] = id; });
  const dl = document.getElementById('catDL'); if (dl) dl.remove(); recomputeAll(); persist();
}
function allCats(){
  const out = ['inc'].concat(subsOf('inc').map(s => 'inc/' + s));
  GROUPS.forEach(g => g.cats.forEach(id => { out.push(id); subsOf(id).forEach(s => out.push(id + '/' + s)); }));
  return out.concat(['uns', 'once', 'skip']);
}
function catLabel(s){
  s = String(s || ''); const i = s.indexOf('/'), c = i < 0 ? s : s.slice(0, i), sub = i < 0 ? '' : s.slice(i + 1), b = BY[c];
  if (!b) return s;
  return sub ? b.name + ' › ' + sub : b.name + (subsOf(c).length ? ' (כללי)' : '');
}
function labelToCat(v){ v = String(v || '').trim(); if (!v) return null; for (const x of allCats()) if (x === v || catLabel(x) === v) return x; return null; }
const NEWCAT = '+ קטגוריה חדשה: ', NEWCAT_HINT = '+ קטגוריה חדשה ללקוח הזה (הקלידי שם)', NEWSUB = '+ שורה חדשה: ';
// "ירוקים ונהנים › שתילים" (or with /) = a new line inside an existing category
const subTarget = v => { const m = String(v).replace(NEWSUB, '').match(/^(.+?)\s*[›\/]\s*(.+)$/); if (!m) return null; const name = m[1].replace(/\s*\(כללי\)$/, '').trim(), x = CATS.concat(PSEUDO).find(c => c.name === name); return x && !['uns', 'skip', 'once'].includes(x.id) ? {id:x.id, sub:m[2].trim()} : null; };
function ensureDatalist(){ applyClientCats(cl()); if (document.getElementById('catDL')) return; const dl = document.createElement('datalist'); dl.id = 'catDL'; dl.innerHTML = `<option value="${esc(NEWCAT_HINT)}"></option><option id="catNew" value="" disabled></option>` + allCats().map(x => `<option value="${esc(catLabel(x))}"></option>`).join(''); document.body.appendChild(dl); }
const xStatus = items => {
  const st = items.filter(t => t.settle && !t.man); if (!st.length || st.length !== items.length || st.some(t => !t.x)) return '';
  const gap = r2(st.reduce((a, t) => a + (t.gap || 0), 0));
  return Math.abs(gap) > 0.005 ? `<span class="badge st-over" title="סכום הפער נשאר בדוח כשורה נפרדת ״פער הצלבה״">הוצלב · פער ${fmt(gap)}</span>` : '<span class="badge st-ok">הוצלב ✓</span>';
};
const catSel = (sel, attrs) => `<input class="cs pick" list="catDL" ${attrs} data-cur="${esc(sel)}" value="${esc(catLabel(sel))}" placeholder="הקלידי קטגוריה או סעיף" aria-label="קטגוריה" autocomplete="off">`;
function nvBtn(label, view, cls){ return `<button class="tab ${cls || ''}" data-act="go" data-v="${view}">${label}</button>`; }

/* ---- transactions list (grouped by merchant, or flat) ---- */
function txMatch(t, d){
  if (d.cat && d.cat !== 'all' && catOf(t) !== d.cat) return false;
  if (d.sub !== undefined && d.sub !== null && subOf(t) !== d.sub) return false;
  if (d.month && monthOfTx(t, cl().rep) !== d.month) return false;
  if (d.q && (t.desc + ' ' + t.ex).toLowerCase().indexOf(d.q.toLowerCase()) < 0) return false;
  return true;
}
const srcName = id => { const s = cl().rep.sources.find(x => x.id === id); return s ? s.name : ''; };
function txRow(t, withSel){
  return `<tr class="${withSel === 'sub' ? 'sub' : ''}"><td>${esc(t.date.split('-').reverse().join('/'))}</td><td>${esc(t.desc)}${t.inst ? ` <span class="tag">${instMap[t.id] && instMap[t.id].N ? 'תשלום ' + instMap[t.id].n + ' מתוך ' + instMap[t.id].N : 'תשלומים'}</span>` : ''}${t.settle ? (t.x ? '' : ' <span class="tag">חיוב אשראי ללא פירוט</span>') : ''}${t.virt ? ' <span class="tag">ההפרש בין החיוב בעו״ש לפירוט</span>' : ''}${t.out ? ` <span class="tag">${t.out === 'after' ? 'קנייה אחרי' : 'קנייה לפני'} תקופת הדוח, לא נספרת</span>` : ''}${t.kind === 'inc' ? ' <span class="tag">זיכוי</span>' : ''}</td><td class="a"><span class="tag ${t.type}">${t.type === 'card' ? 'אשראי' : 'עו״ש'}</span> <span class="small">${esc(srcName(t.src))}</span></td><td class="a"><span class="num ${t.kind === 'inc' ? 'pos' : ''}">${fmt(t.kind === 'inc' ? t.amt : t.amt)}</span></td><td class="a">${withSel === 'sub' ? xStatus([t]) : (xStatus([t]) || catSel(catStr(t), `data-t="${t.id}"`))}</td><td class="a">${t.virt ? '' : (catOf(t) === 'once' ? `<button class="x on" data-act="unonce" data-t="${t.id}" title="להחזיר לחישוב" aria-label="להחזיר לחישוב">↺</button>` : `<button class="x one" data-act="once" data-t="${t.id}" title="חד פעמי: להוציא מהחישוב והממוצע" aria-label="חד פעמי">חד פעמי</button>`)}${t.virt ? '' : `<button class="x" data-act="deltx" data-t="${t.id}" title="מחיקת שורת חיוב" aria-label="מחיקת שורת חיוב">×</button>`}</td></tr>`;
}
function listHTML(d){
  buildInstallments();
  const rep = cl().rep, all = rep.tx.filter(t => txMatch(t, d));
  if (!all.length) return `<div class="pad small">אין תנועות להצגה.</div>`;
  const sumAll = all.reduce((a, t) => a + (t.kind === 'exp' ? t.amt : -t.amt), 0);
  let rows = '', shown = 0;
  if (d.group) {
    const groups = {};
    all.forEach(t => { const g = groups[t.rk] || (groups[t.rk] = {rk:t.rk, name:t.desc, n:0, sum:0, items:[], cats:{}}); g.n++; g.sum += (t.kind === 'exp' ? t.amt : -t.amt); g.items.push(t); const c = catStr(t); g.cats[c] = (g.cats[c] || 0) + 1; });
    const gl = Object.values(groups).sort((a, b) => Math.abs(b.sum) - Math.abs(a.sum));
    gl.slice(0, ui.limit).forEach(g => {
      const topCat = Object.keys(g.cats).sort((a, b) => g.cats[b] - g.cats[a])[0], mixed = Object.keys(g.cats).length > 1;
      const open = !!ui.open[g.rk];
      rows += `<tr class="gr"><td colspan="2"><button class="cell" data-act="gtoggle" data-g="${esc(g.rk)}" aria-expanded="${open}">${open ? '▾' : '◂'} ${esc(g.name)}</button> <span class="small">(${g.n} ${g.n === 1 ? 'תנועה' : 'תנועות'}${mixed ? ', שיוך מעורב' : ''})</span></td><td class="a">${g.items[0].type === 'card' ? '<span class="tag card">אשראי</span>' : '<span class="tag bank">עו״ש</span>'}</td><td class="a"><span class="num">${fmt(g.items.every(t => t.kind === 'inc') ? -g.sum : g.sum)}</span>${g.items.every(t => t.kind === 'inc') ? ' <span class="tag">זיכוי</span>' : ''}</td><td class="a">${xStatus(g.items) || catSel(topCat, `data-g="${esc(g.rk)}"`)}</td><td></td></tr>`;
      if (open) rows += g.items.slice().sort((a, b) => a.date < b.date ? 1 : -1).map(t => txRow(t, 'sub')).join('');
      shown++;
    });
    if (gl.length > ui.limit) rows += `<tr><td colspan="6" class="a"><button class="btn ghost" data-act="more">הצגת עוד בתי עסק (${gl.length - ui.limit})</button></td></tr>`;
  } else {
    all.slice().sort((a, b) => a.date < b.date ? 1 : -1).slice(0, ui.limit).forEach(t => { rows += txRow(t, true); shown++; });
    if (all.length > ui.limit) rows += `<tr><td colspan="6" class="a"><button class="btn ghost" data-act="more">הצגת עוד תנועות (${all.length - ui.limit})</button></td></tr>`;
  }
  return `<div class="scroll"><table class="lst"><thead><tr><th>תאריך</th><th>בית עסק / תיאור</th><th class="a">מקור</th><th class="a">סכום</th><th class="a">קטגוריה / סעיף</th><th class="a"></th></tr></thead><tbody>${rows}</tbody></table></div><div class="pad small">סה״כ בתצוגה: <b class="num">${fmt(sumAll)}</b> · ${all.length} תנועות</div>`;
}
function drillControls(d){
  return `<label class="small"><input type="checkbox" data-act="applyall" ${ui.applyAll ? 'checked' : ''}> שינוי שיוך חל על כל התנועות של אותו בית עסק, ונשמר להמשך</label>
    <label class="small"><input type="checkbox" data-act="grouptoggle" ${d.group ? 'checked' : ''}> קיבוץ לפי בית עסק</label>`;
}
function drillView(){
  const d = ui.drill; if (!d) return '';
  const title = (d.cat === 'all' ? 'כל התנועות' : (BY[d.cat] ? BY[d.cat].name : '') + (d.sub ? ' › ' + d.sub : (d.sub === '' ? ' › ללא סעיף' : ''))) + (d.month ? ' · ' + mLabel(d.month) : ' · כל התקופה');
  const rep = cl().rep;
  const months = [...new Set(rep.tx.map(t => monthOfTx(t, rep)))].sort();
  return `<div class="ov" data-act="ovclose"><div class="modal" role="dialog" aria-label="${esc(title)}" aria-modal="true">
    <header><h2>${esc(title)}</h2><button class="xbtn" data-act="drillclose" aria-label="סגירה">×</button></header>
    <div class="bar2"><input type="text" id="dq" value="${esc(d.q || '')}" placeholder="חיפוש בית עסק" aria-label="חיפוש">
      <select id="dm" class="cs" aria-label="חודש"><option value="">כל התקופה</option>${months.map(k => `<option value="${k}" ${d.month === k ? 'selected' : ''}>${esc(mLabel(k))}</option>`).join('')}</select>
      ${drillControls(d)}</div>
    <div class="body" id="dlist">${listHTML(d)}</div></div></div>`;
}

/* ================= view: report step 1 (load) ================= */
function pendingView(){
  const p = ui.pending; if (!p) return '';
  const tbl = p.tables[p.ti], rows = tbl.rows, hs = rows[p.hdr] || [];
  const colOpts = sel => `<option value="">— ללא —</option>` + hs.map((h, i) => `<option value="${i}" ${sel === i ? 'selected' : ''}>${i + 1}. ${esc(hnorm(h) || '(ריק)')}</option>`).join('');
  const field = (role, label, needed) => `<label>${label}${needed ? ' *' : ''}<select data-pm="${role}">${colOpts(p.map[role])}</select></label>`;
  const norm = normalizeTable(tbl, p.hdr, p.map, p.type, p.sign, p.all), cnt = norm.length, ntab = countTables(tbl, p.hdr);
  const sample = norm.slice(0, 5);
  const prevRows = rows.slice(p.hdr, p.hdr + 7);
  return `<section class="card map" style="margin-bottom:14px"><h2>בדיקת קובץ לפני ייבוא · ${p.type === 'card' ? 'תדפיס אשראי' : 'תדפיס עו״ש'}</h2><div class="pad">
    <p class="hint">זיהיתי את העמודות אוטומטית. בדקי שהתצוגה נכונה, ותקני אם צריך. אפשר לראות למטה איך התנועות הראשונות ייקראו.</p>
    <div class="grid2">
      <label>שם התדפיס *<input type="text" data-pm="name" value="${esc(p.name)}" placeholder="למשל: ויזה כאל 1234"></label>
      <label>סוג התדפיס<select data-pm="type"><option value="card" ${p.type === 'card' ? 'selected' : ''}>אשראי</option><option value="bank" ${p.type === 'bank' ? 'selected' : ''}>עו״ש</option></select></label>
      ${p.tables.length > 1 ? `<label>גיליון<select data-pm="ti">${p.tables.map((t, i) => `<option value="${i}" ${p.ti === i ? 'selected' : ''}>${esc(t.name)} (${t.rows.length} שורות)</option>`).join('')}</select></label>` : ''}
      <label>שורת הכותרות (מספר שורה)<input type="number" min="1" max="${rows.length}" data-pm="hdr" value="${p.hdr + 1}"></label>
      ${field('date', 'עמודת תאריך', true)}${field('desc', 'עמודת בית עסק / תיאור', true)}
      ${p.type === 'card' || p.map.debit == null ? field('amt', p.type === 'card' ? 'עמודת סכום חיוב' : 'עמודת סכום (עמודה אחת)', p.map.debit == null && p.map.credit == null) : ''}
      ${p.type === 'bank' ? field('debit', 'עמודת חובה (הוצאה)') + field('credit', 'עמודת זכות (הכנסה)') : ''}
      ${field('cdate', 'תאריך חיוב (אם יש)')}${field('extra', 'סוג עסקה / פירוט (אם יש)')}${field('ic', 'קטגוריה של חברת האשראי (אם יש)')}
      ${p.type === 'bank' && p.map.debit == null && p.map.credit == null ? `<label>בעמודה אחת, הוצאות הן<select data-pm="sign"><option value="neg" ${p.sign === 'neg' ? 'selected' : ''}>מספרים שליליים</option><option value="pos" ${p.sign === 'pos' ? 'selected' : ''}>מספרים חיוביים</option></select></label>` : ''}
    </div>
    <div class="prev"><table><tbody>${prevRows.map((r, i) => `<tr>${hs.map((_, c) => (i === 0 ? '<th>' : '<td>') + esc(String(r[c] == null ? '' : r[c]).slice(0, 40)) + (i === 0 ? '</th>' : '</td>')).join('')}</tr>`).join('')}</tbody></table></div>
    ${ntab > 1 ? `<div class="ok-box">בגיליון יש ${ntab} טבלאות של עסקאות (למשל בארץ ובחו״ל). <label><input type="checkbox" data-pm="all" ${p.all ? 'checked' : ''}> לייבא את כולן, כל אחת לפי העמודות שזוהו בה</label></div>` : ''}
    <div class="${cnt ? 'ok-box' : 'warn-box'}">${cnt ? `זוהו ${cnt} תנועות. לדוגמה: ` + sample.map(s => `${esc(s.date.split('-').reverse().join('/'))} · ${esc(s.desc.slice(0, 28))} · ${fmt(s.amt)}${s.kind === 'inc' ? ' (הכנסה)' : ''}`).join(' | ') : 'לא זוהו תנועות. בדקי את שורת הכותרות ואת עמודת התאריך והסכום.'}</div>
    <div class="panel" style="border-color:var(--line)"><button class="btn" data-act="doimport" ${cnt ? '' : 'disabled'}>ייבוא ${cnt} תנועות</button><button class="btn ghost" data-act="cancelimport">ביטול</button></div>
  </div></section>`;
}
function startPending(type, fileName, tables){
  const best = tables.map((t, i) => ({i, det:detectMapping(t.rows), n:t.rows.length})).sort((a, b) => ((b.det ? b.det.score : 0) - (a.det ? a.det.score : 0)) || b.n - a.n)[0];
  const tbl = tables[best.i], det = best.det || {hdr:0, map:{}};
  ui.pending = {type, tables, ti:best.i, hdr:det.hdr, map:det.map, sign:'neg', all:true, name:(fileName || '').replace(/\.[^.]+$/, '')};
}
function loadView(){
  const rep = cl().rep;
  const srcRows = rep.sources.map(s => `<tr><td>${esc(s.name)}</td><td><span class="tag ${s.type}">${s.type === 'card' ? 'אשראי' : 'עו״ש'}</span></td><td>${s.from ? esc(s.from.split('-').reverse().join('/')) + ' – ' + esc(s.to.split('-').reverse().join('/')) : ''}</td><td>${s.n}${s.empty ? ' <span class="small">(אין עסקאות בחודש הזה)</span>' : (!s.n && s.dup ? ` <span class="small">(כל ${s.dup} העסקאות כבר נטענו מקובץ אחר)</span>` : (s.dup ? ` <span class="small">(${s.dup} כפולות דולגו)</span>` : ''))}</td><td><span class="num">${fmt(s.total)}</span></td><td><button class="btn ghost" data-act="delsrc" data-id="${s.id}">הסרה</button></td></tr>`).join('');
  const dz = (type, title, hint) => `<div class="card"><h2>${title}</h2><div class="pad">
      <p class="hint" style="margin:0">${hint}</p>
      <label class="filebtn"><input type="file" accept=".xlsx,.xls,.csv,.txt" data-file="${type}">בחירת קובץ (Excel או CSV)</label>
      <details class="paste"><summary>או הדבקת טבלה מהאקסל</summary><textarea id="paste-${type}" placeholder="העתיקי את הטבלה (כולל שורת הכותרות) והדביקי כאן" style="min-height:90px"></textarea><button class="btn" data-act="pastego" data-type="${type}" style="margin-top:6px">קריאת הטקסט</button></details>
    </div></div>`;
  return `<section>
    <p class="lead">שלב ראשון: טעינת התדפיסים שהלקוח שלח. אפשר לטעון כמה תדפיסי אשראי וכמה תדפיסי עו״ש, ולהוסיף בכל זמן. הקבצים נקראים בדפדפן בלבד ולא נשלחים לשום מקום.</p>
    ${ui.msg ? `<div class="ok-box">${esc(ui.msg)}</div>` : ''}
    ${pendingView()}
    <label class="filebtn" style="margin-bottom:14px;padding:28px"><input type="file" multiple accept=".xlsx,.xls,.csv,.txt" data-file="auto">גרירה של כל התדפיסים לכאן, או לחיצה לבחירה. אפשר לבחור כמה קבצים יחד, והמערכת מזהה לבד אשראי ועו״ש ועוברת ישר לדוח.</label>
    <div class="dz">${dz('card', 'תדפיס אשראי', 'פירוט עסקאות מחברת האשראי (ויזה, ישראכרט, מקס וכו׳) בקובץ Excel או CSV.')}${dz('bank', 'תדפיס עו״ש', 'תנועות חשבון הבנק (עובר ושב) בקובץ Excel או CSV. מכאן מגיעות ההכנסות, והוא משמש להצלבת חיובי האשראי.')}</div>
    <div class="card srcs"><h2>תדפיסים שנטענו</h2>${rep.sources.length ? `<div class="scroll"><table class="tbl"><thead><tr><th>שם</th><th>סוג</th><th>תקופה</th><th>תנועות</th><th>סה״כ</th><th></th></tr></thead><tbody>${srcRows}</tbody></table></div>
      <div class="pad small">${rep.dupes ? `${rep.dupes} תנועות כפולות (מקבצים חופפים) דולגו אוטומטית. ` : ''}<button class="btn" data-act="go" data-v="fix">המשך להצלבה ולשיוך ←</button></div>` : `<div class="pad small">עוד לא נטען אף תדפיס.</div>`}</div>
  </section>`;
}

/* ================= view: report step 2 (cross-check + assignment) ================= */
const fixD = () => ({cat:'uns', group:ui.fixGroup, q:ui.fixQ});
// Explain the credit-card cross-check line by line, so a missing match can be understood.
function crossDiag(cx){
  const dFmt = s => s ? s.split('-').reverse().join('/') : '—';
  const dd = (a, b) => Math.abs((Date.parse(a) - Date.parse(b)) / 864e5);
  const groups = cx.groups || [];
  const anyCd = groups.some(g => g.cd);
  const settles = [].concat(cx.matched.map(m => ({s:m.s, st:'ok', g:m.g})), cx.near.map(n => ({s:n.s, st:'near', g:n.g})), (cx.covered || []).map(s => ({s, st:'cov'})), cx.unmatched.map(s => ({s, st:'miss'})))
    .sort((a, b) => a.s.date < b.s.date ? -1 : 1);
  const closest = s => groups.map(g => ({g, diff:r2(s.amt - g.sum), days:g.cd ? dd(g.cd, s.date) : null})).sort((a, b) => Math.abs(a.diff) - Math.abs(b.diff))[0];
  const why = (s, c) => {
    if (!groups.length) return 'לא נטען פירוט אשראי';
    if (!anyCd) return 'בקובצי האשראי אין עמודת ״תאריך חיוב״, ולכן אי אפשר לשייך חיוב לפירוט';
    if (!c) return '';
    if (c.days != null && c.days > 12) return `הפירוט הקרוב ביותר בסכום יורד ב־${dFmt(c.g.cd)}, רחוק מתאריך החיוב בעו״ש`;
    if (Math.abs(c.diff) > 1.01) return `אין פירוט באותו סכום. הקרוב ביותר: ${fmt(c.g.sum)} (חיוב ${dFmt(c.g.cd)}${c.g.card ? ', כרטיס ' + c.g.card : ''}), הפרש ${fmt(c.diff)}`;
    if (c.g.card && s.card && c.g.card !== s.card) return `הסכום תואם, אבל הכרטיס שונה (${s.card} מול ${c.g.card})`;
    return '';
  };
  const ST = {ok:['הותאם', 'st-ok'], near:['הותאם עם הפרש', 'st-over'], cov:['מכוסה בתקופה', 'st-ok'], miss:['ללא פירוט', 'st-over']};
  const rows = settles.map(({s, st, g}) => { const c = st === 'miss' ? closest(s) : null; return `<tr><td>${esc(dFmt(s.date))}</td><td>${esc(s.desc)}</td><td><span class="num">${fmt(s.amt)}</span></td><td><span class="badge ${ST[st][1]}">${ST[st][0]}</span></td>
    <td class="small">${st === 'ok' || st === 'near' ? `פירוט ${esc(g.card ? 'כרטיס ' + g.card + ', ' : '')}חיוב ${esc(dFmt(g.cd))}: <span class="num">${fmt(g.sum)}</span>` : esc(why(s, c))}</td></tr>`; }).join('');
  const per = cl().rep.period, outside = g => !per || !g.cd ? '' : g.cd.slice(0, 7) > per.to ? 'יורד אחרי תקופת העו״ש (תקין)' : g.cd.slice(0, 7) < per.from ? 'ירד לפני תקופת העו״ש (תקין)' : '';
  const grows = groups.slice().sort((a, b) => (a.cd || '') < (b.cd || '') ? -1 : 1).map(g => `<tr><td>${esc(g.card || '—')}</td><td>${esc(dFmt(g.cd))}</td><td>${g.n}</td><td><span class="num">${fmt(g.sum)}</span></td><td><span class="badge ${g.matched ? 'st-ok' : 'st-none'}">${g.matched ? 'נמצא בעו״ש' : outside(g) || 'לא נמצא בעו״ש'}</span></td></tr>`).join('');
  return `<details class="card" style="margin-bottom:14px"><summary style="cursor:pointer;padding:10px 16px;font-weight:700">פירוט ההצלבה: כל חיוב אשראי בעו״ש מול הפירוטים שנטענו</summary>
    <div class="pad small">החיוב בעו״ש מותאם לפירוט כשהסכום זהה (עד ₪1) ותאריך החיוב בפירוט רחוק עד 12 יום מהחיוב בעו״ש.</div>
    <div class="scroll"><table class="lst"><thead><tr><th>תאריך בעו״ש</th><th>תיאור</th><th>סכום</th><th>מצב</th><th>פירוט / סיבה</th></tr></thead><tbody>${rows}</tbody></table></div>
    <div class="pad"><b>הפירוטים שנטענו (לפי כרטיס ותאריך חיוב)</b></div>
    <div class="scroll"><table class="lst"><thead><tr><th>כרטיס</th><th>תאריך חיוב</th><th>עסקאות</th><th>סה״כ</th><th></th></tr></thead><tbody>${grows || '<tr><td colspan="5">—</td></tr>'}</tbody></table></div>
  </details>`;
}
function catsPanel(){
  const c = cl(), list = c.extraCats || [];
  return `<div class="card noprint" style="margin-bottom:14px"><h2>קטגוריות ושורות מיוחדות ללקוח הזה</h2><div class="pad">
    <p class="small">למשל ״הוצאות עסק״ או ״הוצאות על הורים״. הקטגוריה נוספת רק ל${esc(c.name)}: אפשר לשייך אליה שורות, היא מופיעה בדוח, בתקציב ובדוח החודשי של הלקוח/ה.</p>
    ${list.length ? `<div class="row-btns">${list.map(x => `<span class="tag">${esc(x.name)} ${ui.delCatArm === x.id ? `<span class="note-s">${catInUse(x.id) ? 'יש בה שורות או תקציב: השורות יחזרו ל״ללא שיוך״, וסעיפי התקציב שלה יימחקו.' : ''} למחוק את ״${esc(x.name)}״?</span> <button class="btn danger sm" data-act="delcat-yes" data-id="${x.id}">כן, למחוק</button> <button class="btn ghost sm" data-act="delcat-no">ביטול</button>` : `<button class="x" data-act="delcat" data-id="${x.id}" title="מחיקת הקטגוריה" aria-label="מחיקת הקטגוריה">×</button>`}</span>`).join('')}</div>` : ''}
    <p class="small" style="margin-top:12px"><b>הוספת שורה (סעיף) בתוך קטגוריה</b>, למשל ״שתילים״ בתוך ״ירוקים ונהנים״. אפשר גם להקליד בשדה הקטגוריה של שורה: ״ירוקים ונהנים › שתילים״.</p>
    <div class="row-btns"><select id="subcat" aria-label="קטגוריה">${CATS.filter(x => x.id !== 'inc').map(x => `<option value="${x.id}" ${ui.subCat === x.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select><input type="text" id="newsub" maxlength="40" placeholder="שם השורה" aria-label="שם השורה"><button class="btn" data-act="addsub">+ הוספת שורה</button></div>
    ${Object.keys(c.extraSubs || {}).some(k => (c.extraSubs[k] || []).length) ? `<div class="row-btns"><span class="small">שורות שהוספת:</span> ${Object.keys(c.extraSubs).filter(k => BY[k]).map(k => c.extraSubs[k].map(n => `<span class="tag">${esc(BY[k].name + ' › ' + n)} <button class="x" data-act="delsub" data-c="${k}" data-s="${esc(n)}" title="מחיקת השורה" aria-label="מחיקת השורה">×</button></span>`).join('')).join('')}</div>` : ''}
    <p class="small" style="margin-top:12px"><b>קטגוריה חדשה</b></p>
    <div class="row-btns"><input type="text" id="newcat" maxlength="40" placeholder="שם הקטגוריה החדשה" aria-label="שם הקטגוריה החדשה"><button class="btn" data-act="addcat">+ הוספת קטגוריה</button>${ui.catMsg ? `<span class="note-s">${esc(ui.catMsg)}</span>` : ''}</div>
  </div></div>`;
}
function fixView(){
  const rep = cl().rep;
  if (!rep.tx.length) return `<section class="card" style="margin-bottom:14px"><h2>הצלבה ושיוך</h2><div class="pad">עוד לא נטענו תדפיסים. <button class="btn" data-act="go" data-v="load">לטעינת תדפיסים</button></div></section>${catsPanel()}`;
  const cx = crossRes, haveBank = rep.sources.some(s => s.type === 'bank'), haveCard = rep.sources.some(s => s.type === 'card');
  const unsList = rep.tx.filter(t => catOf(t) === 'uns'), unsSum = unsList.filter(t => t.kind === 'exp').reduce((a, t) => a + t.amt, 0);
  const expAll = rep.tx.filter(t => { const c = catOf(t); return c !== 'skip' && c !== 'inc' && t.kind === 'exp'; }).reduce((a, t) => a + t.amt, 0);
  const matchedSum = cx.matched.reduce((a, m) => a + m.s.amt, 0), missingSum = cx.unmatched.reduce((a, s) => a + s.amt, 0);
  const dFmt = s => s.split('-').reverse().join('/');
  const un = cx.unmatched.slice().sort((x, y) => y.amt - x.amt), unDates = cx.unmatched.map(s => s.date).sort();
  const miss = un.slice(0, 6).map(s => `<li>${esc(dFmt(s.date))} · <b class="num">${fmt(s.amt)}</b></li>`).join('') + (un.length > 6 ? `<li class="small">ועוד ${un.length - 6} חיובים קטנים יותר</li>` : '');
  const covSum = (cx.covered || []).reduce((a, s) => a + s.amt, 0);
  const nearRows = cx.near.map(n => `<li>${esc(dFmt(n.s.date))} · בעו״ש <b class="num">${fmt(n.s.amt)}</b>, בתדפיס <b class="num">${fmt(n.g.sum)}</b>, הפרש <b class="num">${fmt(n.diff)}</b></li>`).join('');
  const unsCred = unsList.filter(t => t.kind === 'inc'), unsCredSum = unsCred.reduce((a, t) => a + t.amt, 0), unsExpN = unsList.length - unsCred.length;
  const d = fixD();
  return `<section>
    <p class="lead">שלב שני: ההצלבה בין התדפיסים והשיוך של שורות החיוב לקטגוריות. מה שלא זוהה נשאר ב״ללא שיוך״, ואפשר לשייך אותו כאן בלחיצה אחת לכל בית עסק.</p>
    <div class="cards4">
      <div class="stat"><small>חיובי אשראי שהוצלבו</small><b class="num">${cx.matched.length + cx.near.length + (cx.covered || []).length}</b><em>החיוב בעו״ש לא נספר פעמיים: במקומו נספרות העסקאות מהתדפיס. מה שלא מוסבר בתדפיס נשאר בדוח כ״פער הצלבה״.</em></div>
      <div class="stat"><small>חיובי אשראי בעו״ש ללא פירוט</small><b class="num" style="color:${cx.unmatched.length ? 'var(--bad-fg)' : 'inherit'}">${cx.unmatched.length}</b><em>${cx.unmatched.length ? fmt0(missingSum) + ' שאין להם תדפיס תואם' : (haveBank ? 'הכול הוצלב' : 'לא נטען עו״ש')}</em></div>
      <div class="stat"><small>עדיין ללא שיוך</small><b class="num">${unsList.length}</b><em>${fmt0(unsSum)} הוצאות${expAll ? ' · ' + pct(unsSum / expAll) + ' מההוצאות' : ''}${unsCred.length ? ` · ${unsCred.length} זיכויים (${fmt0(unsCredSum)}) שלא נספרו כהכנסה` : ''}</em></div>
      <div class="stat"><small>תנועות כפולות שדולגו</small><b class="num">${rep.dupes || 0}</b><em>מקבצים שחופפים בתקופה</em></div>
    </div>
    ${catsPanel()}
    ${!haveBank ? `<div class="warn-box">לא נטען תדפיס עו״ש, ולכן אין נתוני הכנסות ולא בוצעה הצלבה מול הבנק. <button class="btn" data-act="go" data-v="load">לטעינת עו״ש</button></div>` : ''}
    ${haveBank && !haveCard && cx.unmatched.length ? `<div class="warn-box">בעו״ש יש חיובי כרטיס אשראי, אבל לא נטענו תדפיסי אשראי. החיובים נשארים ללא שיוך עד שיטענו. <button class="btn" data-act="go" data-v="load">לטעינת אשראי</button></div>` : ''}
    ${cx.unmatched.length && haveCard ? `<div class="warn-box" style="align-items:flex-start;flex-direction:column"><b>בעו״ש יש ${cx.unmatched.length} חיובי אשראי, בין ${esc(dFmt(unDates[0]))} ל-${esc(dFmt(unDates[unDates.length - 1]))}, בסך ${fmt0(missingSum)}, שאין להם פירוט בתדפיסי האשראי שנטענו.</b><span>כנראה חסר תדפיס אשראי לתקופה הזו. עד שייטען, החיובים נשארים ב״ללא שיוך״ ונספרים כהוצאה.</span><ul style="margin:0;padding-inline-start:20px">${miss}</ul></div>` : ''}
    ${cx.near.length ? `<div class="warn-box" style="align-items:flex-start;flex-direction:column"><b>חיובי אשראי בעו״ש שהותאמו לתדפיס עם הפרש. העסקאות מהתדפיס נספרות, וההפרש נשאר בדוח כשורת ״פער הצלבה״ ב״ללא שיוך״:</b><ul style="margin:0;padding-inline-start:20px">${nearRows}</ul></div>` : ''}
    ${(cx.covered || []).length ? `<div class="${(cx.covGaps || []).length ? 'warn-box' : 'ok-box'}">${cx.covered.length} חיובי אשראי נוספים בעו״ש (${fmt0(covSum)}) לא הותאמו לפירוט מסוים, אבל יש תדפיס אשראי לאותה תקופה, והעסקאות שלו כבר בדוח.${(cx.covGaps || []).length ? ` <b>חלק מהסכום לא מוסבר בתדפיסים: ${cx.covGaps.map(b => `${esc(b.mk.split('-').reverse().join('/'))}: בעו״ש ${fmt0(b.bank)}, בתדפיסים ${fmt0(b.card)}, פער ${fmt0(b.gap)}`).join(' · ')}. הפער נשאר בדוח ב״ללא שיוך״ (שורת ״פער הצלבה״), כך ששום סכום לא יוצא מהנתונים.</b>` : ' סכום העסקאות בתדפיסים מכסה את החיובים, ולכן אין פער.'} <button class="btn ghost" data-act="drill" data-cat="skip">הצגה</button></div>` : ''}
    ${haveBank && haveCard ? crossDiag(cx) : ''}
    <div class="card"><h2>שורות חיוב ללא שיוך</h2>
      <div class="bar2" style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;padding:10px 16px;border-bottom:1px solid var(--line)"><input type="text" id="fq" value="${esc(ui.fixQ)}" placeholder="חיפוש בית עסק" style="border:1px solid var(--line);border-radius:8px;padding:6px 10px;background:var(--field)">${drillControls({group:ui.fixGroup})}
        <span style="flex:1"></span><button class="btn ghost" data-act="drill" data-cat="all">כל התנועות</button><button class="btn" data-act="go" data-v="report">לדוח ←</button></div>
      <div id="dlist">${unsList.length ? listHTML(d) : '<div class="pad ok-box">כל התנועות שויכו לקטגוריות. אפשר להמשיך לדוח.</div>'}</div>
    </div>
  </section>`;
}

/* ================= view: report step 3 ================= */
function chartGeneric(items, nameA, nameB){
  const n = items.length, W = Math.max(560, n * 96), H = 230, padB = 44, padT = 16, ph = H - padB - padT;
  const max = Math.max(1, ...items.map(r => Math.max(r.a, r.b)));
  const bw = 26, gap = (W - n * bw * 2) / (n + 1);
  let g = '';
  [0, .5, 1].forEach(f => { const y = padT + ph - ph * f; g += `<line x1="0" x2="${W}" y1="${y}" y2="${y}" stroke="var(--line)" stroke-width="1"/><text x="${W - 4}" y="${y - 4}" font-size="10" fill="var(--muted)" text-anchor="end" direction="ltr">${esc(Math.round(max * f).toLocaleString('he-IL'))}</text>`; });
  items.forEach((r, i) => {
    const x = gap * (i + 1) + i * bw * 2, h1 = ph * Math.max(0, r.a) / max, h2 = ph * Math.max(0, r.b) / max;
    g += `<rect x="${x}" y="${padT + ph - h1}" width="${bw}" height="${h1}" rx="4" fill="var(--bar1)"/><rect x="${x + bw + 3}" y="${padT + ph - h2}" width="${bw}" height="${h2}" rx="4" fill="var(--bar2)"/><text x="${x + bw}" y="${H - 18}" font-size="12" text-anchor="middle" fill="var(--ink)">${esc((r.label || '').slice(0, 12))}</text>`;
  });
  return `<div class="scroll"><svg viewBox="0 0 ${W} ${H}" width="100%" style="min-width:${Math.min(W, 560)}px;max-width:100%" role="img" aria-label="${esc(nameA)} מול ${esc(nameB)} לפי חודש">${g}</svg></div>
  <div class="legend"><span><i style="background:var(--bar1)"></i>${esc(nameA)}</span><span><i style="background:var(--bar2)"></i>${esc(nameB)}</span></div>`;
}
function reportView(){
  const c = cl(), rep = c.rep;
  if (!rep.tx.length) return `<section class="card"><h2>הדוח הראשוני</h2><div class="pad">עוד לא נטענו תדפיסים. <button class="btn" data-act="go" data-v="load">לטעינת תדפיסים</button></div></section>`;
  const R = buildReport(), hasInc = R.months.some(m => R.income(m.k) > 0);
  const manual = num(rep.manualIncome), avgInc = hasInc ? R.avgInc : manual, net = avgInc - R.avgExp;
  const unsAvg = R.avg('uns'), unsShare = R.avgExp ? unsAvg / R.avgExp : 0;
  const top = R.catList.filter(id => id !== 'uns').map(id => ({id, v:R.avg(id)})).sort((a, b) => b.v - a.v).slice(0, 3).filter(x => x.v > 0);
  const incl = R.months.filter(m => m.incl).length;
  const cellBtn = (txt, cat, mk, cls, sub) => `<button class="cell ${cls || ''}" data-act="drill" data-cat="${cat}" ${mk ? `data-month="${mk}"` : ''} ${sub !== undefined ? `data-sub="${esc(sub)}"` : ''}>${txt}</button>`;
  const cols = R.months;
  const head = `<tr><th>קטגוריה / סעיף</th>${cols.map(m => `<th class="${m.incl ? '' : 'excl'}">${esc(mShort(m.k))}</th>`).join('')}<th class="sep">ממוצע חודשי לסעיף</th></tr>`;
  const money = n => `<span class="num">${fmt(n, true)}</span>`;
  const line = (cls, id, label, dot, getter, allowDrill) => `<tr class="${cls}"><td>${dot ? `<span class="dot" style="--cat:#${BY[id] ? BY[id].color : 'ccc'}"></span>` : ''}${allowDrill ? cellBtn(esc(label), id, null) : esc(label)}</td>${cols.map(m => { const v = getter(m.k); return `<td class="${m.incl ? '' : 'excl'}">${allowDrill ? cellBtn(money(v), id, m.k) : money(v)}</td>`; }).join('')}<td class="sep">${noSubs(id) ? `<b>${money(id === 'inc' ? R.avgInc : R.avg(id))}</b> ${xbtn(id, '', id === 'inc' ? R.avgInc : R.avg(id))}` : ''}</td></tr>`;
  const xfer = cl().rep.xfer || {};
  const noSubs = id => { if (!BY[id] || id === 'uns' || id === 'tot') return false; const l = R.subs[id] || []; return !l.length || (l.length === 1 && l[0] === ''); };
  const xbtn = (id, s, v) => (id === 'uns' || id === 'var' || NOT_IN_MONTHS.includes(id) || v <= 0.5) ? '' : (xfer[id + '/' + s] === Math.round(v) ? `<button class="xf done noprint" data-act="xfer" data-cat="${id}" data-sub="${esc(s)}" data-v="${v}" title="להעביר שוב">✓ בתקציב</button>` : `<button class="xf noprint" data-act="xfer" data-cat="${id}" data-sub="${esc(s)}" data-v="${v}">העברה לתקציב</button>`);
  const subRows = id => { const list = R.subs[id] || []; if (!list.length || (list.length === 1 && list[0] === '')) return ''; return list.map(s => { const key = id + '/' + s; return `<tr class="sub2"><td>${cellBtn(esc(s || 'ללא סעיף'), id, null, '', s)}</td>${cols.map(m => `<td class="${m.incl ? '' : 'excl'}">${cellBtn(money((R.SM[m.k] || {})[key] || 0), id, m.k, '', s)}</td>`).join('')}<td class="sep"><b>${money(R.avgSub(key))}</b> ${xbtn(id, s, R.avgSub(key))}</td></tr>`; }).join(''); };
  let body = line('cat', 'inc', 'הכנסות', false, k => R.income(k), true) + subRows('inc');
  GROUPS.forEach(g => {
    g.cats.forEach(id => { body += line('cat', id, BY[id].name, true, k => (R.M[k] || {})[id] || 0, true) + subRows(id); });
  });
  body += line('cat', 'uns', 'ללא שיוך', true, k => (R.M[k] || {}).uns || 0, true);
  if (crossRes.unmatched.length) {
    const um = {}; crossRes.unmatched.forEach(s => { const k = monthOfTx(s, rep); um[k] = (um[k] || 0) + s.amt; });
    body += `<tr class="sub2"><td>מתוכם: חיובי אשראי ללא פירוט תדפיס</td>${cols.map(m => `<td class="${m.incl ? '' : 'excl'}">${money(um[m.k] || 0)}</td>`).join('')}<td class="sep"></td></tr>`;
  }
  body += line('t', 'tot', 'סה״כ הוצאות', false, k => R.total(k), false);
  body += `<tr class="t"><td>נטו (הכנסות פחות הוצאות)</td>${cols.map(m => { const v = (hasInc ? R.income(m.k) : manual) - R.total(m.k); return `<td class="${m.incl ? '' : 'excl'}"><span class="num ${v < 0 ? 'neg' : 'pos'}">${fmt(v, true)}</span></td>`; }).join('')}<td class="sep"></td></tr>`;

  const chartItems = cols.map(m => ({label:mShort(m.k), a:hasInc ? R.income(m.k) : manual, b:R.total(m.k)}));
  return `<section>
    ${ui.msg ? `<div class="ok-box noprint">${esc(ui.msg)}</div>` : ''}
    <div class="monthbar noprint" style="justify-content:space-between"><p class="lead" style="margin:0">שלב שלישי: הדוח הראשוני, פירוט המצב כיום לפי חודשים. לחיצה על סכום פותחת את העסקאות שחושבו בו, ואפשר לשייך אותן מחדש.</p>
      <span style="display:flex;gap:8px"><button class="btn" data-act="present">מצב הצגה ללקוח</button></span></div>
    <div class="card" style="margin-bottom:14px"><div class="pad" style="display:flex;gap:16px;flex-wrap:wrap;align-items:center"><b style="font-size:18px">דוח ראשוני · ${esc(c.name)}</b><span class="small">${R.from ? esc(mLabel(R.from.slice(0, 7))) + ' – ' + esc(mLabel(R.to.slice(0, 7))) : ''} · ${rep.sources.length} תדפיסים · ${rep.tx.length} תנועות</span></div></div>
    ${crossRes.unmatched.length ? `<div class="warn-box noprint">חסר פירוט ל־${crossRes.unmatched.length} חיובי אשראי בעו״ש (${fmt0(crossRes.unmatched.reduce((a, s) => a + s.amt, 0))}). הם נספרים ב״ללא שיוך״ עד שייטען תדפיס האשראי התואם. <button class="btn" data-act="go" data-v="fix">לפרטים</button></div>` : ''}
    ${R.months.some(m => (R.M[m.k] || {}).unsInc) ? `<div class="warn-box noprint">${fmt0(R.months.reduce((a, m) => a + ((R.M[m.k] || {}).unsInc || 0), 0))} בזיכויים בעו״ש (למשל העברות) טרם שויכו, ולכן לא נספרו כהכנסה. <button class="btn" data-act="drill" data-cat="uns">לשיוך</button></div>` : ''}
    ${(() => { const incTx = rep.tx.filter(t => catOf(t) === 'inc' && t.kind === 'inc'); const other = incTx.filter(t => !INC_RE.test(t.desc.toLowerCase())), oSum = other.reduce((a, t) => a + t.amt, 0), tSum = incTx.reduce((a, t) => a + t.amt, 0); return other.length ? `<div class="warn-box noprint">כל מה שנכנס לחשבון נספר כהכנסה: ${fmt0(tSum)} בסך הכול, מתוכם ${fmt0(oSum)} ב־${other.length} כניסות שאינן משכורת או קצבה (למשל העברות). אם חלק מהן אינו הכנסה, אפשר להעביר אותו לקטגוריה אחרת. <button class="btn" data-act="drill" data-cat="inc">לבדיקת ההכנסות</button></div>` : ''; })()}
    ${unsShare > 0.0005 ? `<div class="warn-box noprint">${fmt0(unsAvg)} בממוצע לחודש (${pct(unsShare)} מההוצאות) עדיין ללא שיוך. <button class="btn" data-act="drill" data-cat="uns">לשיוך עכשיו</button></div>` : ''}
    <div class="cards4">
      <div class="stat"><small>הכנסה חודשית ממוצעת</small><b class="num">${fmt0(avgInc)}</b><em>${hasInc ? 'לפי תדפיסי העו״ש' : 'ללא תדפיס עו״ש, ערך ידני'}</em></div>
      <div class="stat"><small>הוצאה חודשית ממוצעת</small><b class="num">${fmt0(R.avgExp)}</b><em>${incl} חודשים בממוצע</em></div>
      <div class="stat"><small>עודף / גירעון חודשי</small><b class="num ${net < 0 ? 'neg' : 'pos'}">${fmt0(net)}</b><em>${net < 0 ? 'ההוצאות עולות על ההכנסות' : 'ההכנסות מכסות את ההוצאות'}</em></div>
      <div class="stat"><small>ההוצאות הגדולות</small><b style="font-size:16px;line-height:1.5">${top.map(x => esc(BY[x.id].name)).join('<br>') || '–'}</b><em>${top.map(x => fmt0(x.v)).join(' · ')}</em></div>
    </div>
    ${!hasInc ? `<div class="card noprint" style="margin-bottom:14px"><div class="pad" style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">לא נטען תדפיס עו״ש. הכנסה חודשית ידנית: <input type="text" inputmode="decimal" dir="ltr" id="minc" value="${nv(rep.manualIncome)}" placeholder="₪" style="border:1px solid var(--line);border-radius:8px;padding:6px 10px;background:var(--field);width:130px"></div></div>` : ''}
    <div class="chips noprint"><span class="small">חודשים שנכללים בממוצעים (בכרטיסים ובעמודת הסעיפים):</span>${R.months.map(m => `<button class="chip ${m.incl ? 'on' : ''} ${m.partial ? 'part' : ''}" data-act="mtoggle" data-m="${m.k}" aria-pressed="${m.incl}">${esc(mShort(m.k))}</button>`).join('')}
      <span class="small">· חודש חלקי מוחרג כברירת מחדל</span>
      <label class="small" style="margin-inline-start:auto">חיובי אשראי נספרים לפי <select id="cardby" class="cs"><option value="tx" ${rep.cardBy === 'tx' ? 'selected' : ''}>תאריך העסקה</option><option value="cd" ${rep.cardBy === 'cd' ? 'selected' : ''}>תאריך החיוב</option></select></label></div>
    <div class="card" style="margin-bottom:14px"><h2>הכנסות מול הוצאות, לפי חודש</h2>${chartGeneric(chartItems, 'הכנסות', 'הוצאות')}</div>
    <p class="small noprint" style="margin:0 0 8px">חיובי האשראי נספרים לפי תאריך הקנייה, חודש בחודשו, ולא לפי החיוב ב־15 לחודש. עסקאות בתשלומים נספרות בחודש שבו התשלום יורד.</p>
    <div class="card" style="margin-bottom:14px"><h2>המצב כיום, לפי חודשים, קטגוריות וסעיפים</h2><div class="scroll"><table class="tbl"><thead>${head}</thead><tbody>${body}</tbody></table></div></div>
    ${onceHTML()}
    ${installmentsHTML()}
    <div class="panel noprint" style="border-color:var(--line)"><span>הצעד הבא: לבחור בטבלה מה עובר לתקציב החודשי (״העברה לתקציב״ ליד כל סעיף). המשתנות מופיעות לבד בעמודת ״מצב מצוי״ בחודש הראשון, והתקציב שלהן נשאר ריק.</span><button class="btn ghost" data-act="xferall">העברת כל הסעיפים לתקציב</button><button class="btn" data-act="openbudget">פתיחת התקציב החודשי</button></div>
  </section>`;
}
function curMap(){ const R = buildReport(), out = {}; (R.subs.var || []).forEach(s => { out[s || 'משתנות – כללי'] = Math.round(R.avgSub('var/' + s)); }); return out; }
function budgetMonth(){ return cl().months.find(m => m.baseline) || null; }
function ensureBudgetMonth(){
  const c = cl(); let m = budgetMonth(); if (m) return m;
  m = newMonth('תקציב – חודש ראשון'); m.baseline = true;
  const R = buildReport();
  (R.subs.var || []).forEach(s => { const v = R.avgSub('var/' + s); if (v <= 0.5) return; const lab = s || 'משתנות – כללי'; if (!m.cats.var.some(x => x.label.trim() === lab)) { const it = m.cats.var.find(x => !x.label.trim()); if (it) it.label = lab; else m.cats.var.push(mkItem(lab)); } });
  const pristine = c.months.length === 1 && !c.months[0].baseline && monthTot(c.months[0]).tb === 0 && monthTot(c.months[0]).tp === 0 && incTot(c.months[0]) === 0;
  if (pristine) { const p = c.months[0]; p.baseline = true; p.label = m.label; persist(); return p; }
  c.months.unshift(m);
  persist(); return m;
}
function transfer(cat, sub, value){
  if (cat === 'var' || (cat !== 'inc' && !TRK_EXP.some(x => x.id === cat))) return;
  const c = cl(), m = ensureBudgetMonth(), v = Math.round(value);
  const lab = sub || BY[cat].name;
  if (cat === 'inc') {
    let it = m.income.find(x => x.label.trim() === lab) || m.income.find(x => !x.label.trim() && !num(x.amount) && !num(x.cur));
    if (!it) { it = {id:uid(), label:lab, amount:0}; m.income.push(it); }
    it.label = lab; it.amount = v;
  } else {
    const list = m.cats[cat] || (m.cats[cat] = []);
    // an empty row, or an unused placeholder row ("עסקה 1", "הלוואה 2"), takes the item's name
    const free = x => (!x.label.trim() || /^(עסקה|הלוואה)\s*\d+$/.test(x.label.trim())) && !num(x.budget) && !num(x.paid) && !num(x.cur);
    let it = list.find(x => x.label.trim() === lab) || list.find(free);
    if (!it) { it = mkItem(lab); list.push(it); }
    it.label = lab; it.budget = v;
    if (cat === 'dea') { const x = buildInstallments().list.find(y => y.desc.slice(0, 30) === sub); if (x && x.endKey) it.end = x.endKey; }
  }
  c.rep.xfer = c.rep.xfer || {}; c.rep.xfer[cat + '/' + sub] = v; persist();
}
function transferAll(){
  const R = buildReport();
  ['inc'].concat(EXP.map(x => x.id)).forEach(id => {
    if (NOT_IN_MONTHS.includes(id) || id === 'var') return;
    const subs = R.subs[id] || [];
    if (!subs.length) return;
    if (subs.length === 1 && subs[0] === '') { const v = id === 'inc' ? R.avgInc : R.avg(id); if (v > 0.5) transfer(id, '', v); return; }
    subs.forEach(s => { const v = R.avgSub(id + '/' + s); if (v > 0.5) transfer(id, s, v); });
  });
}

/* ================= tracking views ================= */
function cubeCompact(m, cat){
  const D = cat.id === 'dea', cc = D ? 'c-compact dea' : 'c-compact';
  const rows = (m.cats[cat.id] || []).map(it => `
    <div class="row ${cc}">
      <button class="x" data-act="delrow" data-c="${cat.id}" data-i="${it.id}" title="מחיקת סעיף" aria-label="מחיקת סעיף">×</button>
      <input class="lab" data-f="label" data-c="${cat.id}" data-i="${it.id}" value="${esc(it.label)}" placeholder="סעיף חדש" aria-label="שם הסעיף">
      <input class="n" inputmode="decimal" dir="ltr" data-f="budget" data-c="${cat.id}" data-i="${it.id}" value="${nv(it.budget)}" placeholder="–" aria-label="תקציב">
      <input class="n" inputmode="decimal" dir="ltr" data-f="paid" data-c="${cat.id}" data-i="${it.id}" value="${nv(it.paid)}" placeholder="–" aria-label="שולם">
      <span class="num" data-calc="rowLeft" data-c="${cat.id}" data-i="${it.id}"></span>
      ${D ? `<input class="endm" type="month" data-f="end" data-c="${cat.id}" data-i="${it.id}" value="${esc(it.end || '')}" aria-label="מועד סיום העסקה" title="מועד סיום העסקה">` : ''}
    </div>`).join('');
  return `<article class="cube" style="--cat:#${cat.color}">
    <header class="cube-h"><h3>${esc(cat.name)}</h3></header>
    <div class="row head ${cc}"><span></span><span>סעיף</span><span>תקציב</span><span>שולם</span><span>נותר</span>${D ? '<span>מסתיים</span>' : ''}</div>
    ${rows}
    <div class="row tot ${cc}"><span></span><span>סה״כ</span><span class="num" data-calc="catB" data-c="${cat.id}"></span><span class="num" data-calc="catP" data-c="${cat.id}"></span><span class="num" data-calc="catL" data-c="${cat.id}"></span>${D ? '<span></span>' : ''}</div>
    <button class="add" data-act="addrow" data-c="${cat.id}">+ הוספת סעיף</button>
  </article>`;
}
function cubeWeekly(m, cat){
  const c0 = cl(), B = m.locked ? m.cats.var.some(it => num(it.cur)) : (c0.months[0] && c0.months[0].id === m.id && c0.rep.tx.length > 0), cw = B ? 'c-weekly base' : 'c-weekly';
  // "מצב מצוי" comes from the analysis; the coach may type her own figure (curv), and clearing it brings the computed one back
  const CUR = (B && !m.locked) ? curMap() : {}; const autoCur = it => m.locked ? num(it.cur) : (CUR[it.label.trim()] || 0);
  const curOf = it => it.curv != null ? num(it.curv) : autoCur(it);
  const rows = (m.cats[cat.id] || []).map(it => `
    <div class="row ${cw}">
      <button class="x" data-act="delrow" data-c="${cat.id}" data-i="${it.id}" title="מחיקת סעיף" aria-label="מחיקת סעיף">×</button>
      <input class="lab" data-f="label" data-c="${cat.id}" data-i="${it.id}" value="${esc(it.label)}" placeholder="סעיף חדש" aria-label="שם הסעיף">
      ${B ? `<input class="n cur ${it.curv != null ? 'man' : ''}" inputmode="decimal" dir="ltr" data-f="curv" data-c="${cat.id}" data-i="${it.id}" value="${it.curv != null ? nv(it.curv) : (autoCur(it) ? nv(autoCur(it)) : '')}" placeholder="–" aria-label="מצב מצוי" title="${it.curv != null ? 'הוזן ידנית. מחיקת הערך מחזירה את החישוב מהניתוח (' + fmt(autoCur(it)) + ')' : 'מחושב מניתוח הנתונים. אפשר לשנות'}">` : ''}
      <input class="n" inputmode="decimal" dir="ltr" data-f="budget" data-c="${cat.id}" data-i="${it.id}" value="${nv(it.budget)}" placeholder="–" aria-label="תקציב">
      ${[0,1,2,3,4].map(k => `<input class="n" inputmode="decimal" dir="ltr" data-f="w" data-w="${k}" data-c="${cat.id}" data-i="${it.id}" value="${nv(it.w[k])}" placeholder="–" aria-label="שבוע ${k+1}">`).join('')}
      <span class="num" data-calc="rowPaid" data-c="${cat.id}" data-i="${it.id}"></span>
      <span class="num" data-calc="rowLeft" data-c="${cat.id}" data-i="${it.id}"></span>
      <input class="note" data-f="note" data-c="${cat.id}" data-i="${it.id}" value="${esc(it.note)}" placeholder="הערה" aria-label="הערה">
    </div>`).join('');
  return `<article class="cube wide" style="--cat:#${cat.color}">
    <header class="cube-h"><h3>${esc(cat.name)}</h3></header>
    <div class="scroll">
    <div class="row head ${cw}"><span></span><span>סעיף</span>${B ? '<span>מצב מצוי</span>' : ''}<span>תקציב</span><span>שבוע 1</span><span>שבוע 2</span><span>שבוע 3</span><span>שבוע 4</span><span>שבוע 5</span><span>סה״כ שולם</span><span>נותר</span><span>הערות</span></div>
    ${rows}
    <div class="row tot ${cw}"><span></span><span>סה״כ</span>${B ? `<span class="num cur">${fmt((m.cats[cat.id] || []).reduce((a, it) => a + curOf(it), 0), true)}</span>` : ''}<span class="num" data-calc="catB" data-c="${cat.id}"></span>${[0,1,2,3,4].map(k => `<span class="num" data-calc="catW" data-w="${k}" data-c="${cat.id}"></span>`).join('')}<span class="num" data-calc="catP" data-c="${cat.id}"></span><span class="num" data-calc="catL" data-c="${cat.id}"></span><span></span></div>
    </div>
    <button class="add" data-act="addrow" data-c="${cat.id}">+ הוספת סעיף</button>
  </article>`;
}
function cubeIncome(m, cat){
  const ci = 'c-income';
  const rows = m.income.map(it => `
    <div class="row ${ci}">
      <button class="x" data-act="delrow" data-c="inc" data-i="${it.id}" title="מחיקה" aria-label="מחיקה">×</button>
      <input class="lab" data-f="label" data-c="inc" data-i="${it.id}" value="${esc(it.label)}" placeholder="מקור הכנסה" aria-label="מקור הכנסה">
      <input class="n" inputmode="decimal" dir="ltr" data-f="amount" data-c="inc" data-i="${it.id}" value="${nv(it.amount)}" placeholder="–" aria-label="סכום">
    </div>`).join('');
  return `<article class="cube" style="--cat:#${cat.color}">
    <header class="cube-h"><h3>${esc(cat.name)}</h3></header>
    <div class="row head ${ci}"><span></span><span>סעיף</span><span>הכנסה</span></div>
    ${rows}
    <div class="row tot ${ci}"><span></span><span>סה״כ הכנסות</span><span class="num" data-calc="incTot"></span></div>
    <button class="add" data-act="addrow" data-c="inc">+ הוספת מקור הכנסה</button>
  </article>`;
}
function breakdownRows(){
  const cell = (k, r) => `<td><span class="num" data-calc="${k}" data-r="${r}"></span></td>`;
  const pctCell = r => `<td><span data-calc="bdPct" data-r="${r}"><span class="num"></span><span class="bar"><i></i></span></span></td>`;
  const stCell = r => `<td><span class="badge" data-calc="bdSt" data-r="${r}"></span></td>`;
  const line = (cls, label, r, dot) => `<tr class="${cls}"><td>${dot ? `<span class="dot" style="--cat:#${dot}"></span>` : ''}${esc(label)}</td>${cell('bdB', r)}${cell('bdP', r)}${cell('bdL', r)}${pctCell(r)}${stCell(r)}</tr>`;
  let h = '';
  TGROUPS_OF().forEach(g => { h += line('g', g.name, g.id); g.cats.forEach(id => { h += line('', BY[id].name, id, BY[id].color); }); });
  return h + line('t', 'סה״כ הוצאות', 'tot');
}
function syncVarItems(m){ const R = buildReport(); let changed = false; (R.subs.var || []).forEach(s => { if (R.avgSub('var/' + s) <= 0.5) return; const lab = s || 'משתנות – כללי'; if ((m.cats.var || []).some(x => x.label.trim() === lab)) return; const it = (m.cats.var || []).find(x => !x.label.trim() && !num(x.budget)); if (it) it.label = lab; else (m.cats.var = m.cats.var || []).push(mkItem(lab)); changed = true; }); if (changed) persist(); }
/* The coach arranges the monthly cards herself: order and "under the previous one" are kept for all clients. */
const CUBE_DEFAULT = ['inc', 'var', 'hou', 'sub', 'trn', 'med', 'ins', 'dea', 'loa', 'sto'];
function cubeOrder(){
  const ids = CUBE_DEFAULT.concat((cl().extraCats || []).map(x => x.id).filter(id => BY[id]));
  const saved = (ws.cubeOrder || []).filter(id => ids.includes(id));
  return saved.concat(ids.filter(id => !saved.includes(id)));
}
const cubeStacked = () => new Set(ws.cubeStack || ['sto']);
function cubesHtml(m){
  const order = cubeOrder(), stacked = cubeStacked(), cols = [];
  order.forEach(id => { if (stacked.has(id) && cols.length && !['inc', 'var'].includes(cols[cols.length - 1][0])) cols[cols.length - 1].push(id); else cols.push([id]); });
  const one = (id, i) => {
    const h = id === 'inc' ? cubeIncome(m, BY.inc) : id === 'var' ? cubeWeekly(m, BY.var) : cubeCompact(m, BY[id]);
    const ctl = `<span class="mv noprint"><button class="mvb" data-act="cubemv" data-id="${id}" data-d="-1" title="להזיז קודם" aria-label="להזיז את ${esc(BY[id].name)} קודם" ${i === 0 ? 'disabled' : ''}>▶</button><button class="mvb" data-act="cubemv" data-id="${id}" data-d="1" title="להזיז אחר כך" aria-label="להזיז את ${esc(BY[id].name)} אחר כך" ${i === order.length - 1 ? 'disabled' : ''}>◀</button>${BY[id] && BY[id].custom ? `<button class="mvb" data-act="delcat-month" data-id="${id}" title="מחיקת הקטגוריה" aria-label="מחיקת הקטגוריה ${esc(BY[id].name)}">🗑</button>` : ''}${['inc', 'var'].includes(id) ? '' : `<button class="mvb ${stacked.has(id) ? 'on' : ''}" data-act="cubestack" data-id="${id}" title="${stacked.has(id) ? 'להוציא ממתחת לקטגוריה הקודמת' : 'לשים מתחת לקטגוריה הקודמת'}" aria-pressed="${stacked.has(id)}">⤓</button>`}</span>`;
    return h.replace('<article class="cube', `<article data-cube="${id}" class="cube`).replace('<header class="cube-h">', `<header class="cube-h" draggable="true" data-drag="${id}" title="אפשר לגרור כדי להזיז">${ctl}`);
  };
  return cols.map(col => col.length === 1 ? one(col[0], order.indexOf(col[0])) : `<div class="stack">${col.map(id => one(id, order.indexOf(id))).join('')}</div>`).join('');
}
function moveCube(id, to){
  const order = cubeOrder(), from = order.indexOf(id); if (from < 0 || to < 0 || to >= order.length) return;
  order.splice(from, 1); order.splice(to, 0, id); ws.cubeOrder = order; persist(); render();
}
function monthView(m){
  { const c0 = cl(); if (c0.months[0] && c0.months[0].id === m.id && c0.rep.tx.length) syncVarItems(m); }
  const kvRow = (label, b, p, l, cls) => `<div class="${cls || ''}">${label}</div><div class="${cls || ''}"><span class="num" data-calc="${b}"></span></div><div class="${cls || ''}"><span class="num" data-calc="${p}"></span></div><div class="${cls || ''}"><span class="num" data-calc="${l}"></span></div>`;
  const cube = id => cubeCompact(m, BY[id]);
  return `
  <section data-month="${m.id}">
    <div class="monthbar">
      <div class="box"><b>חודש</b><input data-f="mlabel" value="${esc(m.label)}" aria-label="שם החודש"></div>
      ${m.locked ? (ui.tplEdit
        ? `<span class="badge st-over">✏️ עורכים את התבנית הראשונית · השינויים נשמרים אוטומטית</span><button class="btn" data-act="tpledit-done">סיום עריכה</button>`
        : `<span class="badge st-none">🔒 תבנית ראשונית · נשמרה ב־${esc(new Date(cl().template.savedAt).toLocaleDateString('he-IL'))}${cl().template.editedAt ? ' · עודכנה ב־' + esc(new Date(cl().template.editedAt).toLocaleDateString('he-IL')) : ''}</span><button class="btn ghost" data-act="tpledit">✏️ עריכת התבנית</button>
           ${ui.tplRedo ? `<span class="note-s">להחליף את התבנית בנתונים של ״${esc((cl().months[0] || {}).label || '')}״ כפי שהם עכשיו?</span><button class="btn" data-act="tplredo-yes">כן, להחליף</button><button class="btn ghost" data-act="tplredo-no">ביטול</button>` : `<button class="btn ghost" data-act="tplredo">שמירה מחדש מהחודש הראשון</button>`}`) : ''}
      ${!m.locked && cl().months[0] && cl().months[0].id === m.id ? (cl().template
        ? `<button class="btn ghost" data-act="go" data-v="template">🔒 צפייה בתבנית הראשונית</button>`
        : (ui.tplArm ? `<span class="note-s">התבנית נשמרת כתמונת מצב של ״לפני״. אפשר לערוך אותה גם אחר כך. לשמור?</span><button class="btn" data-act="savetpl-yes">כן, לשמור תבנית</button><button class="btn ghost" data-act="savetpl-no">ביטול</button>`
                     : `<button class="btn" data-act="savetpl">שמירת תבנית ראשונית</button>`)) : ''}
      ${!m.locked && cl().months.length > 1 ? (ui.delArm
        ? `<span class="note-s">למחוק את החודש הזה לצמיתות?</span><button class="btn danger" data-act="delmonth-yes">כן, למחוק</button><button class="btn ghost" data-act="delmonth-no">ביטול</button>`
        : `<button class="btn ghost" data-act="delmonth">מחיקת החודש</button>`) : ''}
    </div>
    <div class="analysis">
      <div class="card">
        <h2>מצב נתון</h2>
        <div class="big"><span class="t">סה״כ הכנסות</span><span class="v num" data-calc="mInc"></span></div>
        <div class="kv">
          <div class="h">מדד</div><div class="h">תקציב</div><div class="h">שולם</div><div class="h">נותר</div>
          ${kvRow('סה״כ הוצאות קבועות (כולל מגורים)', 'mFixB', 'mFixP', 'mFixL')}
          ${kvRow('סה״כ משתנות (כולל תחבורה, רפואה, אחר)', 'mVarB', 'mVarP', 'mVarL')}
          ${kvRow('סה״כ הוצאות', 'mTotB', 'mTotP', 'mTotL', 'tot')}
        </div>
        <div class="big rem"><span class="t">כמה נותר מהתקציב<br><small style="font-weight:400;color:var(--muted)">הכנסות פחות מה ששולם</small></span><span class="v num" data-calc="mRem"></span></div>
        <div class="big"><span class="t">מצב כללי</span><span class="badge" data-calc="mStatus"></span></div>
        <div class="counts"><div><b data-calc="cntOver"></b>קטגוריות בחריגה</div><div><b data-calc="cntOk"></b>בתוך התקציב</div><div><b data-calc="cntNone"></b>ללא נתונים</div></div>
      </div>
      <div class="card">
        <h2>פירוט קטגוריות</h2>
        <div class="scroll"><table class="tbl"><thead><tr><th>קטגוריה</th><th>תקציב</th><th>שולם</th><th>נותר</th><th>% ניצול</th><th>סטטוס</th></tr></thead><tbody>${breakdownRows()}</tbody></table></div>
      </div>
    </div>
    <div class="cubes">${cubesHtml(m)}</div>
    <p class="noprint small" style="margin-top:8px">אפשר לסדר את הקטגוריות: גוררים קטגוריה בכותרת שלה, או לוחצים על החצים. ⤓ מניח קטגוריה מתחת לזו שלפניה. ${ws.cubeOrder || ws.cubeStack ? '<button class="btn ghost sm" data-act="cuberesort">חזרה לסדר הרגיל</button>' : ''}</p>
  </section>`;
}
function summaryView(){
  const rows = cl().months.map(m => ({m, t:monthTot(m)}));
  const act = rows.filter(r => r.t.tp > 0);
  const sum = k => rows.reduce((a, r) => a + k(r.t), 0);
  const T = {inc:sum(t => t.inc), fix:sum(t => t.grp.fix.p), vr:sum(t => t.grp.vr.p), tp:sum(t => t.tp), rem:sum(t => t.rem), tb:sum(t => t.tb)};
  const avg = k => act.length ? act.reduce((a, r) => a + k(r.t), 0) / act.length : 0;
  const money = (n, neg) => `<span class="num ${neg ? (n < 0 ? 'neg' : (n > 0 ? 'pos' : '')) : ''}">${fmt(n, true)}</span>`;
  const stBadge = s => s ? `<span class="badge ${s === 'תקין' ? 'st-ok' : 'st-over'}">${s}</span>` : '';
  const pctC = (p, b) => { const r = b ? p / b : 0; return `<span class="num">${b ? pct(r) : '–'}</span><span class="bar ${r > 1 ? 'over' : ''}"><i style="width:${Math.min(100, r * 100)}%"></i></span>`; };
  const body = rows.map(({m, t}) => `<tr><td>${esc(m.label)}</td><td>${money(t.inc)}</td><td>${money(t.grp.fix.p)}</td><td>${money(t.grp.vr.p)}</td><td>${money(t.tp)}</td><td>${money(t.rem, true)}</td><td>${pctC(t.tp, t.tb)}</td><td>${stBadge(monthStatus(t))}</td></tr>`).join('');
  const tot = `<tr class="t"><td>סה״כ לתקופה</td><td>${money(T.inc)}</td><td>${money(T.fix)}</td><td>${money(T.vr)}</td><td>${money(T.tp)}</td><td>${money(T.rem, true)}</td><td>${pctC(T.tp, T.tb)}</td><td>${stBadge(monthStatus({inc:T.inc, tb:T.tb, tp:T.tp}))}</td></tr>`;
  const head = rows.map(r => `<th>${esc(r.m.label)}</th>`).join('');
  const line = (cls, label, vals, total, dot) => `<tr class="${cls}"><td>${dot ? `<span class="dot" style="--cat:#${dot}"></span>` : ''}${esc(label)}</td>${vals.map(v => `<td>${money(v)}</td>`).join('')}<td>${money(total)}</td></tr>`;
  let mx = '';
  TGROUPS_OF().forEach(g => {
    const gv = rows.map(r => r.t.grp[g.id].p); mx += line('g', g.name, gv, gv.reduce((a, b) => a + b, 0));
    g.cats.forEach(id => { const v = rows.map(r => r.t.per[id].p); mx += line('', BY[id].name, v, v.reduce((a, b) => a + b, 0), BY[id].color); });
  });
  const tv = rows.map(r => r.t.tp); mx += line('t', 'סה״כ הוצאות (שולם)', tv, tv.reduce((a, b) => a + b, 0));
  return `
  <section>
    <div class="sumgrid">
      <div class="card"><h2>סיכום חודשי</h2>
        <div class="scroll"><table class="tbl"><thead><tr><th>חודש</th><th>הכנסות</th><th>הוצאות קבועות</th><th>הוצאות משתנות</th><th>סה״כ הוצאות (שולם)</th><th>נותר מהתקציב</th><th>% ניצול תקציב</th><th>סטטוס</th></tr></thead><tbody>${body}${tot}</tbody></table></div>
      </div>
      <div class="kpis">
        <div class="kpi"><small>סה״כ הכנסות בתקופה</small><b class="num">${fmt(T.inc, true)}</b></div>
        <div class="kpi"><small>סה״כ הוצאות ששולמו</small><b class="num">${fmt(T.tp, true)}</b></div>
        <div class="kpi"><small>כמה נותר מהתקציב</small><b class="num ${T.rem < 0 ? 'neg' : ''}">${fmt(T.rem, true)}</b></div>
        <div class="kpi"><small>חודשים עם נתונים</small><b>${act.length}</b></div>
      </div>
    </div>
    <div class="card" style="margin-bottom:16px"><h2>הכנסות מול הוצאות, לפי חודש</h2>${chartGeneric(rows.map(r => ({label:r.m.label, a:r.t.inc, b:r.t.tp})), 'הכנסות', 'הוצאות ששולמו')}</div>
    <div class="card"><h2>מה שולם בכל קטגוריה, לפי חודש</h2><div class="scroll"><table class="tbl"><thead><tr><th>קטגוריה</th>${head}<th>סה״כ</th></tr></thead><tbody>${mx}</tbody></table></div></div>
  </section>`;
}
function helpView(){
  const steps = [
    'לכל לקוח/ה יש תיק משלו. בוחרים לקוח בתיבה שבראש הדף, ויוצרים לקוח חדש בבחירה ״+ לקוח חדש״.',
    'דוח ראשוני, שלב 1: גוררים לכאן את כל התדפיסים של הלקוח (אשראי ועו״ש, קבצי Excel או CSV, כמה קבצים יחד). המערכת מזהה לבד את הסוג והעמודות, ועוברת ישר לדוח.',
    'שלב 2: המערכת מצלבת את חיובי האשראי שמופיעים בעו״ש מול תדפיסי האשראי, כדי שלא יספרו פעמיים, ומשייכת כל שורת חיוב לקטגוריה לפי בית העסק. מה שלא זוהה נשאר ב״ללא שיוך״.',
    'בשלב 2 אפשר לשייך כל בית עסק לקטגוריה בלחיצה אחת. השיוך נשמר, וכל התנועות הבאות של אותו בית עסק ישויכו אוטומטית.',
    'שלב 3: הדוח מציג את המצב כיום לפי חודשים, קטגוריות וסעיפים (למשל מגורים › חשמל, מים, שכ״ד; משתנות › מזון, ביגוד; ביטוחים; חיסכון), עם ממוצע חודשי. לחיצה על כל סכום פותחת את העסקאות שחושבו בו, ושם אפשר לשייך עסקה לקטגוריה או לסעיף אחרים.',
    'חודש חלקי (תחילת או סוף תקופה) מוחרג מהממוצע כברירת מחדל. אפשר לכלול או להחריג חודשים בלחיצה על שם החודש.',
    'כפתור ״מצב הצגה ללקוח״ מסתיר את כלי העריכה ומגדיל את הכתב, להצגה נוחה בפגישה.',
    'בדוח, ליד כל סעיף, יש כפתור ״העברה לתקציב״: הסכום (הממוצע החודשי) נכנס לתקציב של החודש הראשון, באותה קטגוריה ובאותו סעיף. בקוביית המשתנות בחודש הראשון יש עמודת ״מצב מצוי״ לפני התקציב, עם הסכומים מהניתוח, והתקציב שלה נשאר ריק.',
    'בשיוך לקטגוריה אפשר להקליד חלק מהשם (למשל ״שכר״ או ״ביגוד״) ולבחור מהרשימה, בלי לגלול.',
    'עסקאות בתשלומים מוצגות בטבלה נפרדת בדוח: כמה תשלומים כבר ירדו, כמה נשארו, מה ההורדה החודשית ומתי זה מסתיים.',
    'בלשונית ״תיק הלקוח״ שולחים ללקוח קישור אישי לטופס התבנית החודשית. מה שהלקוח ממלא מוצפן אצלו בטלפון, מגיע לכאן, ונקלט לתיק בלחיצה. רק המכשיר שלך מחזיק את המפתח שפותח את הטפסים.',
    'הנתונים נשמרים אוטומטית בדפדפן הזה בלבד. כל לקוח שפותח את הקישור במכשיר שלו מקבל מערכת ריקה. ב״לקוחות וגיבוי״ אפשר לייצא ללקוח קובץ של התיק שלו בלבד.'
  ];
  return `<section class="card help"><h2>איך משתמשים בניהול תזרים</h2><ol>${steps.map(s => `<li>${s}</li>`).join('')}</ol></section>`;
}
let dl = null;
function backupView(){
  const c = cl(), json = JSON.stringify(ui.allClients && !ws.clientMode ? {v:2, cid:ws.cid, clients:ws.clients} : {v:2, cid:c.id, clients:[c]}), cjson = JSON.stringify({v:2, cid:c.id, clients:[c], clientMode:true});
  const rows = ws.clients.map(x => `<div class="cl-row"><input data-f="cname" data-id="${x.id}" value="${esc(x.name)}" aria-label="שם הלקוח"><span class="small">${x.rep.tx.length} תנועות · ${x.months.length} חודשי מעקב</span>
      ${ui.delClientArm === x.id ? `<button class="btn danger" data-act="delclient-yes" data-id="${x.id}">כן, למחוק</button>` : `<button class="btn ghost" data-act="delclient" data-id="${x.id}" ${ws.clients.length < 2 ? 'disabled' : ''}>מחיקה</button>`}
      <button class="btn ghost" data-act="pick" data-id="${x.id}">${x.id === ws.cid ? 'פתוח' : 'פתיחה'}</button></div>`).join('');
  const clientsBlock = ws.clientMode
    ? `<div class="ok-box">המכשיר הזה במצב לקוח: מוצג רק התיק של ${esc(c.name)}, ואי אפשר להוסיף או לראות לקוחות אחרים.</div>`
    : `<p><b>לקוחות</b></p>${rows}<div class="panel" style="border-color:var(--line);margin-top:8px"><button class="btn" data-act="newclient">+ לקוח חדש</button></div>
    <div class="card" style="margin:14px 0"><h2>הפרדה בין לקוחות</h2><div class="pad small">כל הנתונים נשמרים בדפדפן של המכשיר שבו עובדים, ולא בשרת. לקוח שפותח את הקישור במכשיר שלו מקבל מערכת ריקה, ורואה רק את מה שהוזן אצלו. כדי למסור ללקוח את התיק שלו, מייצאים ״קובץ ללקוח״ (בלי לקוחות אחרים) והוא טוען אותו אצלו.</div></div>`;
  return `<section class="card"><h2>לקוחות וגיבוי</h2><div class="pad">
    ${clientsBlock}
    <p class="hint" style="margin-top:18px">הנתונים נשמרים רק בדפדפן הזה, במכשיר הזה.</p>
    <p><b>ייצוא הלקוח הפתוח: ${esc(c.name)}</b></p>
    <p class="small">הקובץ כולל את הלקוח הזה בלבד. ״קובץ ללקוח״ נטען כמכשיר לקוח, שמציג רק את התיק הזה.</p>
    <textarea id="bk" readonly aria-label="נתוני הלקוח">${esc(ui.clientFile ? cjson : json)}</textarea>
    <div class="panel" style="border-color:var(--line);margin-top:8px">
      <label><input type="checkbox" data-act="clientfile" ${ui.clientFile ? 'checked' : ''}> ייצוא כקובץ ללקוח (מצב לקוח)</label>
      ${ws.clientMode ? '' : `<label><input type="checkbox" data-act="allclients" ${ui.allClients ? 'checked' : ''}> כל הלקוחות בקובץ אחד</label>`}
      <button class="btn" data-act="copyjson">העתקת הנתונים</button>
      ${dl ? '<button class="btn" data-act="download">הורדת קובץ</button>' : ''}
      <span class="note-s" id="bkmsg">${esc(ui.msg)}</span>
    </div>
    <p style="margin-top:18px"><b>שחזור / ייבוא לקוח</b></p>
    <label class="filebtn" style="margin-bottom:10px"><input type="file" accept=".json,.txt" data-file="json">בחירת קובץ לקוח לטעינה</label>
    <textarea id="imp" placeholder="או הדביקי כאן נתוני לקוח שיוצאו מהמערכת" aria-label="הדבקת נתוני לקוח"></textarea>
    <div class="panel" style="border-color:var(--line);margin-top:8px"><button class="btn" data-act="import">טעינת הנתונים</button><span class="note-s">קובץ ללקוח מחליף את כל מה שיש במכשיר ומעביר אותו למצב לקוח. קובץ רגיל מוסיף את הלקוח לרשימה.</span></div>
    ${ws.clientMode ? `<p style="margin-top:18px"><b>מצב מכשיר</b></p><div class="panel" style="border-color:var(--line)"><button class="btn ghost" data-act="coachmode">חזרה למצב מאמנת</button></div>` : ''}
    <p style="margin-top:18px"><b>גרסאות שמורות אוטומטית</b></p>
    <p class="small">המערכת שומרת לבד עותק של כל הנתונים פעם ביום (7 הימים האחרונים). אפשר לחזור לאחד מהם אם משהו נמחק או השתנה בטעות.</p>
    <div class="panel" style="border-color:var(--line);flex-direction:column;align-items:stretch">${snapshots().slice().reverse().map((s, i, arr) => { const idx = arr.length - 1 - i, d = new Date(s.t); return `<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap"><span>${esc(d.toLocaleDateString('he-IL'))} ${esc(d.toLocaleTimeString('he-IL', {hour:'2-digit', minute:'2-digit'}))}</span>${ui.snapArm === idx ? `<button class="btn danger" data-act="snap-yes" data-i="${idx}">כן, לחזור לגרסה הזו</button><button class="btn ghost" data-act="snap-no">ביטול</button>` : `<button class="btn ghost" data-act="snap" data-i="${idx}">חזרה לגרסה הזו</button>`}</div>`; }).join('') || '<span class="small">עדיין אין גרסאות שמורות.</span>'}</div>
    <p style="margin-top:18px"><b>איפוס</b></p>
    <div class="panel" style="border-color:var(--line)">${ui.resetArm
      ? `<span class="note-s">למחוק את כל הלקוחות והנתונים במכשיר הזה?</span><button class="btn danger" data-act="reset-yes">כן, לאפס הכול</button><button class="btn ghost" data-act="reset-no">ביטול</button>`
      : `<button class="btn ghost" data-act="reset">איפוס כל הנתונים</button>`}</div>
  </div></section>`;
}

/* ================= render ================= */
const REPV = ['load', 'fix', 'report'], TRKV = ['summary', 'month', 'template'];
function renderHero(){
  const sel = document.getElementById('clientSel'); if (!sel) return;
  sel.style.display = ws.clientMode ? 'none' : '';
  sel.innerHTML = ws.clients.map(c => `<option value="${c.id}" ${c.id === ws.cid ? 'selected' : ''}>${esc(c.name)}</option>`).join('') + (ws.clientMode ? '' : `<option value="__new">+ לקוח חדש</option>`);
}
function renderNav(){
  const c = cl(), v = c.view;
  const grp = REPV.includes(v) ? 'rep' : (TRKV.includes(v) ? 'trk' : v);
  const prim = (id, label, go) => `<button class="tab" data-act="go" data-v="${go}" ${grp === id ? 'aria-current="page"' : ''}>${label}</button>`;
  let h = (ws.clientMode ? '' : prim('intake', 'תיק הלקוח' + (window.CFIntake ? window.CFIntake.badge() : ''), 'intake')) + prim('rep', 'דוח ראשוני', REPV.includes(v) ? v : 'load') + prim('trk', 'מעקב חודשי', TRKV.includes(v) ? v : 'summary') + prim('help', 'הוראות', 'help') + prim('backup', 'לקוחות וגיבוי', 'backup') + `<button class="tab sp noprint" data-act="xlsx" title="ייצוא הדוחות של ${esc(c.name)} לקובץ Excel">⬇ ייצוא ל־Excel</button>`;
  document.getElementById('nav').innerHTML = h;
  let sub = '';
  if (grp === 'rep') sub = [['load', '1', 'טעינת תדפיסים'], ['fix', '2', 'הצלבה ושיוך'], ['report', '3', 'הדוח']].map(([id, n, l]) => `<button class="tab sm" data-act="go" data-v="${id}" ${v === id ? 'aria-current="page"' : ''}><span class="nb">${n}</span>${l}</button>`).join('');
  else if (grp === 'trk') sub = `<button class="tab sm" data-act="go" data-v="summary" ${v === 'summary' ? 'aria-current="page"' : ''}>סיכום חודשים</button>` + c.months.map(m => `<button class="tab sm" data-act="go" data-v="month" data-m="${m.id}" data-tabm="${m.id}" ${v === 'month' && c.monthId === m.id ? 'aria-current="page"' : ''}>${esc(m.label || 'חודש')}</button>`).join('') + (c.template ? `<button class="tab sm" data-act="go" data-v="template" ${v === 'template' ? 'aria-current="page"' : ''}>🔒 תבנית ראשונית</button>` : '') + `<button class="tab sm add" data-act="addmonth">+ חודש חדש</button>`;
  document.getElementById('subnav').innerHTML = sub;
}
function renderPanel(){
  const p = document.getElementById('panel');
  if (ui.panel === 'addmonth') {
    const ms = cl().months, last = ms[ms.length - 1];
    p.innerHTML = `<div class="panel"><label>שם החודש <input type="text" id="newname" value="${esc('חודש ' + (ms.length + 1))}"></label>
      <label><input type="checkbox" id="newcopy" checked> להעתיק סעיפים ותקציבים מהחודש הקודם (${esc(last.label)})</label>
      <button class="btn" data-act="create">יצירת חודש</button><button class="btn ghost" data-act="cancel">ביטול</button></div>`;
    const inp = document.getElementById('newname'); if (inp) { inp.focus(); inp.select(); }
  } else if (ui.panel === 'newclient') {
    p.innerHTML = `<div class="panel"><label>שם הלקוח/ה <input type="text" id="cname" value="${esc('לקוח/ה ' + (ws.clients.length + 1))}"></label>
      <button class="btn" data-act="createclient">יצירת לקוח</button><button class="btn ghost" data-act="cancel">ביטול</button></div>`;
    const inp = document.getElementById('cname'); if (inp) { inp.focus(); inp.select(); }
  } else p.innerHTML = '';
}
function renderDrill(){ const o = document.getElementById('overlay'); if (o) o.innerHTML = drillView(); }
function render(){
  applyClientCats(cl()); ensureDatalist();
  renderHero(); renderNav(); renderPanel();
  const main = document.getElementById('main'), c = cl(), v = c.view;
  if (REPV.includes(v) || v === 'intake') { recomputeIfNeeded(); }
  if (v === 'load') main.innerHTML = loadView();
  else if (v === 'fix') main.innerHTML = fixView();
  else if (v === 'report') main.innerHTML = reportView();
  else if (v === 'summary') main.innerHTML = summaryView();
  else if (v === 'intake') { main.innerHTML = window.CFIntake ? window.CFIntake.view() : '<p class="note-s">טוען…</p>'; if (window.CFIntake) window.CFIntake.mounted(); }
  else if (v === 'help') main.innerHTML = helpView();
  else if (v === 'backup') main.innerHTML = backupView();
  else { const m = curMonth(); main.innerHTML = m ? monthView(m) : ''; updateComputed(); if (m && m.locked && !ui.tplEdit) main.querySelectorAll('input, button.x, button.add').forEach(el => { if (el.tagName === 'INPUT') el.disabled = true; else el.style.display = 'none'; }); }
  renderDrill();
}
let crossFor = null;
function recomputeIfNeeded(){ if (crossFor !== cl().id) { recomputeAll(); crossFor = cl().id; } }
function setCls(el, cls){ el.classList.remove('pos', 'neg', 'st-ok', 'st-over', 'st-none'); if (cls) el.classList.add(cls); }
function updateComputed(){
  const m = curMonth(); if (!m) return;
  const t = monthTot(m);
  const rowOf = el => (m.cats[el.dataset.c] || []).find(i => i.id === el.dataset.i);
  const sign = (el, v) => setCls(el, v < 0 ? 'neg' : (v > 0 ? 'pos' : ''));
  const grpOf = r => r === 'tot' ? {b:t.tb, p:t.tp, l:t.tl} : (t.grp[r] || t.per[r]);
  document.querySelectorAll('#main [data-calc]').forEach(el => {
    const k = el.dataset.calc, c = el.dataset.c;
    switch (k) {
      case 'rowLeft': { const it = rowOf(el); if (!it) break; const b = num(it.budget), p = itemPaid(BY[c], it); el.textContent = (b === 0 && p === 0) ? '–' : fmt(b - p); sign(el, b - p); break; }
      case 'rowPaid': { const it = rowOf(el); if (!it) break; el.textContent = fmt(itemPaid(BY[c], it), true); break; }
      case 'catB': el.textContent = fmt(t.per[c].b, true); break;
      case 'catP': el.textContent = fmt(t.per[c].p, true); break;
      case 'catL': el.textContent = fmt(t.per[c].l, true); sign(el, t.per[c].l); break;
      case 'catW': { const w = +el.dataset.w; el.textContent = fmt((m.cats[c] || []).reduce((a, it) => a + num(it.w[w]), 0), true); break; }
      case 'incTot': el.textContent = fmt(t.inc, true); break;
      case 'mInc': el.textContent = fmt(t.inc); break;
      case 'mFixB': el.textContent = fmt(t.grp.fix.b); break; case 'mFixP': el.textContent = fmt(t.grp.fix.p); break; case 'mFixL': el.textContent = fmt(t.grp.fix.l); sign(el, t.grp.fix.l); break;
      case 'mVarB': el.textContent = fmt(t.grp.vr.b); break; case 'mVarP': el.textContent = fmt(t.grp.vr.p); break; case 'mVarL': el.textContent = fmt(t.grp.vr.l); sign(el, t.grp.vr.l); break;
      case 'mMvB': el.textContent = fmt(t.grp.mv.b); break; case 'mMvP': el.textContent = fmt(t.grp.mv.p); break; case 'mMvL': el.textContent = fmt(t.grp.mv.l); sign(el, t.grp.mv.l); break;
      case 'mTotB': el.textContent = fmt(t.tb); break; case 'mTotP': el.textContent = fmt(t.tp); break; case 'mTotL': el.textContent = fmt(t.tl); sign(el, t.tl); break;
      case 'mRem': el.textContent = fmt(t.rem); sign(el, t.rem); break;
      case 'mStatus': { const s = overall(t); el.textContent = s; setCls(el, s === 'מצב תקין' ? 'st-ok' : (s === 'טרם הוזנו נתונים' ? 'st-none' : 'st-over')); break; }
      case 'cntOver': case 'cntOk': case 'cntNone': { const want = {cntOver:'over', cntOk:'ok', cntNone:'none'}[k]; el.textContent = TRK_EXP.filter(x => catSt(t.per[x.id].b, t.per[x.id].p) === want).length; break; }
      case 'bdB': el.textContent = fmt(grpOf(el.dataset.r).b, true); break;
      case 'bdP': el.textContent = fmt(grpOf(el.dataset.r).p, true); break;
      case 'bdL': { const g = grpOf(el.dataset.r); el.textContent = fmt(g.l, true); sign(el, g.l); break; }
      case 'bdPct': { const g = grpOf(el.dataset.r), r = g.b ? g.p / g.b : 0; el.querySelector('.num').textContent = g.b ? pct(r) : '–'; const bar = el.querySelector('.bar'); bar.querySelector('i').style.width = Math.min(100, r * 100) + '%'; bar.classList.toggle('over', r > 1); break; }
      case 'bdSt': { const g = grpOf(el.dataset.r), s = catSt(g.b, g.p); el.textContent = ST_TXT[s]; setCls(el, 'st-' + s); break; }
    }
  });
}

/* ================= events ================= */
function findItem(m, c, i){ return c === 'inc' ? m.income.find(x => x.id === i) : (m.cats[c] || []).find(x => x.id === i); }
document.addEventListener('input', e => {
  const t = e.target, f = t && t.dataset ? t.dataset.f : null;
  if (t && t.classList && t.classList.contains('pick')) { const o = document.getElementById('catNew'), v = t.value.trim();
    if (o) { const show = v && v !== NEWCAT_HINT && !v.startsWith(NEWCAT) && !v.startsWith(NEWSUB) && !labelToCat(v); o.value = show ? (subTarget(v) ? NEWSUB : NEWCAT) + v : ''; o.disabled = !show; } return; }
  if (t && t.id === 'dq') { ui.drill.q = t.value; ui.limit = 120; const l = document.getElementById('dlist'); if (l) l.innerHTML = listHTML(ui.drill); return; }
  if (t && t.id === 'fq') { ui.fixQ = t.value; ui.limit = 120; const l = document.getElementById('dlist'); if (l) l.innerHTML = listHTML(fixD()); return; }
  if (t && t.id === 'minc') { cl().rep.manualIncome = num(t.value); persist(); return; }
  if (t && t.dataset && t.dataset.pm && ui.pending) { pmChange(t); return; }
  if (!f) return;
  if (f === 'cname') { const c = ws.clients.find(x => x.id === t.dataset.id); if (c) { c.name = t.value; persist(); renderHero(); } return; }
  const m = curMonth(); if (!m || (m.locked && !ui.tplEdit)) return;
  if (m.locked && cl().template) cl().template.editedAt = new Date().toISOString();
  if (f === 'mlabel') { m.label = t.value; const b = document.querySelector('[data-tabm="' + m.id + '"]'); if (b) b.textContent = t.value || 'חודש'; persist(); return; }
  const it = findItem(m, t.dataset.c, t.dataset.i); if (!it) return;
  if (f === 'label') it.label = t.value;
  else if (f === 'note') it.note = t.value;
  else if (f === 'end') it.end = t.value;
  else if (f === 'curv') { if (String(t.value).trim() === '') delete it.curv; else it.curv = num(t.value); t.classList.toggle('man', it.curv != null); }
  else if (f === 'w') it.w[+t.dataset.w] = num(t.value);
  else it[f] = num(t.value);
  persist(); updateComputed();
});
function pmChange(t){
  const p = ui.pending, k = t.dataset.pm;
  if (k === 'name') { p.name = t.value; return; }
  if (k === 'all') { p.all = t.checked; render(); return; }
  if (k === 'sign') p.sign = t.value;
  else if (k === 'type') p.type = t.value;
  else if (k === 'ti') { p.ti = +t.value; const det = detectMapping(p.tables[p.ti].rows); p.hdr = det ? det.hdr : 0; p.map = det ? det.map : {}; }
  else if (k === 'hdr') { p.hdr = Math.max(0, Math.min(p.tables[p.ti].rows.length - 1, (+t.value || 1) - 1)); p.map = mapRow(p.tables[p.ti].rows[p.hdr]); }
  else p.map[k] = t.value === '' ? undefined : +t.value;
  if (k !== 'name') { const y = window.scrollY; render(); window.scrollTo(0, y); }
}
document.addEventListener('change', async e => {
  const t = e.target; if (!t || !t.dataset) return;
  if (t.dataset.pm && ui.pending) { pmChange(t); return; }
  if (t.dataset.file === 'json') { const f = t.files && t.files[0]; if (f) importText(await f.text()); t.value = ''; return; }
  if (t.dataset.file === 'auto') { if (t.files && t.files.length) await onFiles(t.files); t.value = ''; return; }
  if (t.dataset.file) { const f = t.files && t.files[0]; if (f) await onFile(f, t.dataset.file); t.value = ''; return; }
  if ((t.dataset.t || t.dataset.g) && t.classList.contains('pick') && (t.value === NEWCAT_HINT)) { t.value = ''; t.placeholder = 'שם הקטגוריה החדשה, ואז Enter'; t.dataset.mknew = '1'; return; }
  if ((t.dataset.t || t.dataset.g) && t.classList.contains('pick') && t.value.trim() && !labelToCat(t.value) && subTarget(t.value)) {
    const x = subTarget(t.value), err = addClientSub(x.id, x.sub); if (err) { flash(err); t.value = catLabel(t.dataset.cur); return; }
    const v = x.id + '/' + String(x.sub).replace(/[\/›]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40);
    if (t.dataset.t) assignTx(t.dataset.t, v); else setRule(t.dataset.g, v);
    render(); return;
  }
  if ((t.dataset.t || t.dataset.g) && t.classList.contains('pick') && t.value.trim() && !labelToCat(t.value) && (t.value.startsWith(NEWCAT) || t.dataset.mknew || confirm(`ליצור ל${cl().name} קטגוריה חדשה בשם ״${t.value.trim()}״?`))) {
    // a new category for this client, straight from the row being assigned
    const name = t.value.replace(NEWCAT, '').trim(), err = addClientCat(name), x = (cl().extraCats || []).find(c => c.name === name);
    delete t.dataset.mknew;
    if (!x) { flash(err || 'לא הצלחתי ליצור את הקטגוריה.'); t.value = catLabel(t.dataset.cur); return; }
    if (t.dataset.t) assignTx(t.dataset.t, x.id); else setRule(t.dataset.g, x.id);
    render(); return;
  }
  if ((t.dataset.t || t.dataset.g) && t.classList.contains('pick')) { const v = labelToCat(t.value); if (!v || v === t.dataset.cur) { t.value = catLabel(t.dataset.cur); return; } if (t.dataset.t) assignTx(t.dataset.t, v); else setRule(t.dataset.g, v); refreshAfterAssign(); return; }
  if (t.id === 'dm') { ui.drill.month = t.value || null; ui.limit = 120; renderDrill(); return; }
  if (t.id === 'cardby') { cl().rep.cardBy = t.value; recomputeAll(); persist(); render(); return; }
  if (t.id === 'clientSel') { if (t.value === '__new') { ui.panel = 'newclient'; renderHero(); renderPanel(); return; } ws.cid = t.value; ui.panel = null; ui.drill = null; ui.pending = null; crossFor = null; persist(); render(); return; }
  if (t.dataset.act === 'applyall') { ui.applyAll = t.checked; return; }
  if (t.dataset.act === 'clientfile') { ui.clientFile = t.checked; if (t.checked) ui.allClients = false; render(); return; }
  if (t.dataset.act === 'allclients') { ui.allClients = t.checked; if (t.checked) ui.clientFile = false; render(); return; }
  if (t.dataset.act === 'grouptoggle') { if (ui.drill) { ui.drill.group = t.checked; } ui.limit = 120; if (ui.drill) renderDrill(); const l = document.getElementById('dlist'); if (!ui.drill) { ui.fixGroup = t.checked; if (l) l.innerHTML = listHTML(fixD()); } return; }
});
function refreshAfterAssign(){
  const y = window.scrollY, ov = document.querySelector('.ov'), oy = ov ? ov.scrollTop : 0;
  const v = cl().view;
  if (v === 'fix' || v === 'report') render(); else if (ui.drill) renderDrill();
  const o = document.querySelector('.ov'); if (o) o.scrollTop = oy;
  window.scrollTo(0, y);
}
async function onFile(file, type){
  try {
    const buf = await file.arrayBuffer();
    const tables = readTables(buf, file.name);
    if (!tables.length) throw new Error('empty');
    startPending(type, file.name, tables); ui.msg = '';
  } catch(err) { ui.msg = (err && err.message === 'xlsx-missing') ? 'לא ניתן לקרוא קבצי Excel כרגע. אפשר לשמור את הקובץ כ-CSV, או להדביק את הטבלה.' : 'לא הצלחתי לקרוא את הקובץ. נסי לשמור אותו כ-CSV או להדביק את הטבלה.'; }
  render();
}
async function autoImportFile(file){
  const buf = await file.arrayBuffer(); const tables = readTables(buf, file.name);
  const best = tables.map((t, i) => ({i, det:detectMapping(t.rows)})).filter(x => x.det).sort((a, b) => b.det.score - a.det.score)[0];
  const nameOf = () => file.name.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ');
  // a statement for a month with no purchases ("אין עסקאות לחיוב בחודש יולי") is valid: load it as empty
  const noTx = () => tables.some(t => t.rows.some(r => r.some(c => /אין\s+עסקאות|לא\s+נמצאו\s+עסקאות|אין\s+תנועות/.test(String(c)))));
  if (!best) { if (noTx()) { const r = importRaw([], 'card', nameOf(), file.name); r.src.empty = true; persist(); return {ok:true, added:0, dupes:0, type:'card', name:r.src.name, empty:true}; } return {ok:false, tables, file:file.name}; }
  const det = best.det, hs = tables[best.i].rows[det.hdr].map(hnorm).join(' ');
  const type = (det.map.debit != null || det.map.credit != null || (/יתרה/.test(hs) && !/בית\s*ה?עסק/.test(hs))) ? 'bank' : 'card';
  const name = nameOf();
  // Card exports often split one statement over several sheets (e.g. domestic and abroad).
  // Read every sheet that has a transaction table, so the total matches the bank charge.
  // A sheet of the next billing cycle (future / not yet charged) belongs to the next statement: other sheets
  // add only rows charged up to this statement's charge date (e.g. Max "עסקאות בחיוב מיידי").
  const mainRows = normalizeTable(tables[best.i], det.hdr, det.map, type, 'neg', true);
  const maxCd = mainRows.map(x => x.cd).filter(Boolean).sort().pop() || '';
  const seenSheets = new Set();
  let raw = [];
  [best.i].concat(tables.map((t, i) => i).filter(i => i !== best.i)).forEach(i => {
    const t = tables[i], d = i === best.i ? det : detectMapping(t.rows); if (!d) return;
    const sig = JSON.stringify(t.rows.slice(d.hdr)); if (seenSheets.has(sig)) return; seenSheets.add(sig);
    let rows = i === best.i ? mainRows : normalizeTable(t, d.hdr, d.map, type, 'neg', true);
    if (i !== best.i && type === 'card') {
      if (/עתיד|טרם|ממתינ|נדח/.test(t.name || '')) return;
      if (maxCd && rows.some(x => x.cd)) rows = rows.filter(x => x.cd && x.cd <= maxCd);
    }
    // a later sheet that repeats rows of an earlier one (an "all transactions" view) must not count twice
    const prev = {}; raw.forEach(x => { const k = txKey(x, type); prev[k] = (prev[k] || 0) + 1; });
    raw = raw.concat(rows.filter(x => { const k = txKey(x, type); if (prev[k]) { prev[k]--; return false; } return true; }));
  });
  if (!raw.length) { if (noTx()) { const r = importRaw([], type, name, file.name); r.src.empty = true; persist(); return {ok:true, added:0, dupes:0, type, name, empty:true}; } return {ok:false, tables, file:file.name}; }
  const r = importRaw(raw, type, name, file.name);
  return {ok:true, added:r.added, dupes:r.dupes, type, name};
}
async function onFiles(files){
  const list = [...files], done = [], failed = [];
  for (const f of list) { try { const r = await autoImportFile(f); if (r.ok) done.push(r); else failed.push({f, r}); } catch(e) { failed.push({f, r:null, err:e}); } }
  const c = cl();
  ui.msg = done.length ? `נטענו ${done.length} תדפיסים (${done.reduce((a, r) => a + r.added, 0)} תנועות${done.some(r => r.dupes) ? ', כפולות דולגו' : ''}).` : '';
  const empties = done.filter(r => r.empty);
  if (empties.length) ui.msg += ` ${empties.map(r => `״${r.name}״`).join(', ')}: כתוב בקובץ שאין עסקאות לחיוב בחודש הזה, ולכן נטען ריק. זה תקין.`;
  if (failed.length) {
    const ff = failed[0];
    if (ff.r && ff.r.tables) { startPending('card', ff.f.name, ff.r.tables); ui.msg += ` לא הצלחתי לזהות את העמודות בקובץ ״${ff.f.name}״. אפשר לסמן אותן ידנית כאן.`; c.view = 'load'; }
    else ui.msg += ` לא הצלחתי לקרוא את הקובץ ״${ff.f.name}״. כדאי לשמור אותו כ־Excel או CSV.`;
  } else if (done.length) { c.view = 'report'; }
  persist(); render(); window.scrollTo(0, 0);
}
function pasteGo(type){
  const ta = document.getElementById('paste-' + type); const txt = ta ? ta.value : '';
  if (!txt.trim()) { ui.msg = 'לא הודבק טקסט.'; render(); return; }
  const rows = parseDelimited(txt);
  if (rows.length < 2) { ui.msg = 'לא זוהתה טבלה בטקסט שהודבק.'; render(); return; }
  startPending(type, 'הדבקה', [{name:'הדבקה', rows}]); ui.msg = ''; render();
}
function doImport(){
  const p = ui.pending; if (!p) return;
  const raw = normalizeTable(p.tables[p.ti], p.hdr, p.map, p.type, p.sign, p.all);
  if (!raw.length) return;
  const name = (p.name || '').trim() || (p.type === 'card' ? 'תדפיס אשראי' : 'תדפיס עו״ש');
  const r = importRaw(raw, p.type, name, '');
  ui.pending = null; ui.msg = `נוספו ${r.added} תנועות מהתדפיס ״${name}״` + (r.dupes ? `, ${r.dupes} כפולות דולגו` : '') + '.';
  render(); window.scrollTo(0, 0);
}
function doCreate(){
  const c = cl(), name = (document.getElementById('newname').value || '').trim() || ('חודש ' + (c.months.length + 1));
  const copy = document.getElementById('newcopy').checked;
  const m = newMonth(name, c.months[c.months.length - 1], copy);
  c.months.push(m); c.monthId = m.id; c.view = 'month'; ui.panel = null; persist(); render(); window.scrollTo(0, 0);
}
function flash(msg){ ui.msg = msg; const el = document.getElementById('bkmsg'); if (el) el.textContent = msg; }
document.addEventListener('focusin', e => { const t = e.target; if (t.classList && t.classList.contains('pick')) {
    // empty field = the whole list opens; typing searches it
    t.dataset.prev = t.value; t.placeholder = t.value ? 'חיפוש קטגוריה (עכשיו: ' + t.value + ')' : 'חיפוש קטגוריה'; t.value = '';
    setTimeout(() => { try { t.showPicker(); } catch(_) {} }, 0); return; } if (t.classList && t.classList.contains('n')) { const m = curMonth(), it = m && findItem(m, t.dataset.c, t.dataset.i); if (it) { const v = t.dataset.f === 'w' ? it.w[+t.dataset.w] : it[t.dataset.f]; t.value = num(v) === 0 ? '' : String(num(v)); setTimeout(() => { try { t.select(); } catch(_) {} }, 0); } } });
document.addEventListener('focusout', e => { const t = e.target; if (t.classList && t.classList.contains('pick')) { t.placeholder = 'הקלידי קטגוריה או סעיף'; if (!labelToCat(t.value) && t.value !== catLabel(t.dataset.cur)) t.value = catLabel(t.dataset.cur); return; } if (t.classList && t.classList.contains('n')) t.value = nv(t.value); });
document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target && e.target.id === 'newname') { e.preventDefault(); doCreate(); }
  if (e.key === 'Enter' && e.target && e.target.id === 'cname') { e.preventDefault(); createClient(); }
  if (e.key === 'Escape') { if (ui.drill) { ui.drill = null; renderDrill(); } else document.body.classList.remove('present'); }
});
function importText(raw){
  const txt = String(raw).trim();
  try {
    let s = JSON.parse(txt);
    if (s && s.months && !s.clients) { const nc = newClient('לקוח/ה מיובא'); nc.months = s.months; nc.monthId = s.months[0].id; s = {clients:[nc]}; }
    if (!validWs(s)) throw new Error('bad');
    if (s.clientMode) { ws.clients = s.clients.slice(0, 1); ws.clientMode = true; }
    else s.clients.forEach(nc => { const i = ws.clients.findIndex(x => x.id === nc.id); if (i >= 0) ws.clients[i] = nc; else ws.clients.push(nc); });
    ws.cid = s.clients[0].id; crossFor = null; ui.pending = null; ui.drill = null; persist(); ui.msg = 'הלקוח נטען ✓'; render(); window.scrollTo(0, 0);
  } catch(_) { flash('הנתונים לא תקינים. בדקי שבחרת את הקובץ הנכון.'); }
}
let undoTimer = null;
function showUndo(text, fn){
  ui.undo = fn; clearTimeout(undoTimer);
  let el = document.getElementById('toast');
  if (!el) { el = document.createElement('div'); el.id = 'toast'; el.className = 'toast'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
  el.innerHTML = `<span>${esc(text)}</span><button class="btn" data-act="undo">ביטול</button>`; el.style.display = 'flex';
  undoTimer = setTimeout(hideUndo, 9000);
}
function hideUndo(){ ui.undo = null; const el = document.getElementById('toast'); if (el) el.style.display = 'none'; }
function createClient(){
  const name = (document.getElementById('cname').value || '').trim() || ('לקוח/ה ' + (ws.clients.length + 1));
  const c = newClient(name); ws.clients.push(c); ws.cid = c.id; ui.panel = null; ui.pending = null; ui.drill = null; ui.msg = ''; crossFor = null; persist(); render();
}
document.addEventListener('click', async e => {
  const b = e.target.closest ? e.target.closest('[data-act]') : null; if (!b) return;
  const act = b.dataset.act, c = cl(), m = curMonth();
  if (act === 'ovclose') { if (e.target === b) { ui.drill = null; renderDrill(); } return; }
  if (b.tagName === 'INPUT' || b.tagName === 'SELECT') return;
  switch (act) {
    case 'go': { ui.tplEdit = false; ui.tplRedo = false; c.view = b.dataset.v; if (b.dataset.m) c.monthId = b.dataset.m; ui.delArm = false; ui.resetArm = false; ui.delClientArm = null; ui.panel = null; ui.msg = c.view === 'load' ? ui.msg : ''; document.body.classList.remove('present'); persist(); render(); window.scrollTo(0, 0); break; }
    case 'addmonth': ui.panel = ui.panel === 'addmonth' ? null : 'addmonth'; renderPanel(); break;
    case 'newclient': if (ws.clientMode) break; ui.panel = 'newclient'; renderPanel(); window.scrollTo(0, 0); break;
    case 'cancel': ui.panel = null; renderPanel(); renderHero(); break;
    case 'create': doCreate(); break;
    case 'createclient': createClient(); break;
    case 'addcat': { const inp = document.getElementById('newcat'); ui.catMsg = addClientCat(inp && inp.value); ui.delCatArm = null; render(); break; }
    case 'addsub': { const sel = document.getElementById('subcat'), inp = document.getElementById('newsub'); ui.subCat = sel && sel.value; ui.catMsg = addClientSub(sel && sel.value, inp && inp.value) || ('נוספה שורה ״' + (inp && inp.value.trim()) + '״. אפשר לבחור אותה עכשיו בשדה הקטגוריה.'); render(); break; }
    case 'delcat': ui.delCatArm = b.dataset.id; ui.catMsg = ''; render(); break;
    case 'delcat-yes': { const x = (c.extraCats || []).find(x => x.id === b.dataset.id); delClientCat(b.dataset.id); ui.catMsg = x ? `הקטגוריה ״${x.name}״ נמחקה.` : ''; ui.delCatArm = null; render(); break; }
    case 'delcat-no': ui.delCatArm = null; render(); break;
    case 'delcat-month': { const x = (c.extraCats || []).find(x => x.id === b.dataset.id); if (x && confirm(`למחוק את הקטגוריה ״${x.name}״ ללקוח הזה?${catInUse(x.id) ? ' השורות שלה יחזרו ל״ללא שיוך״, וסעיפי התקציב שלה יימחקו.' : ''}`)) { delClientCat(x.id); render(); } break; }
    case 'delsub': { delClientSub(b.dataset.c, b.dataset.s); render(); break; }
    case 'pick': ws.cid = b.dataset.id; ui.pending = null; ui.drill = null; crossFor = null; persist(); render(); break;
    case 'delclient': ui.delClientArm = b.dataset.id; render(); break;
    case 'delclient-yes': { ws.clients = ws.clients.filter(x => x.id !== b.dataset.id); if (!ws.clients.length) ws.clients.push(newClient('לקוח/ה 1')); if (!ws.clients.some(x => x.id === ws.cid)) ws.cid = ws.clients[0].id; ui.delClientArm = null; crossFor = null; persist(); render(); break; }
    case 'addrow': { if (!m) break; const cat = b.dataset.c; if (cat === 'inc') m.income.push({id:uid(), label:'', amount:0}); else m.cats[cat].push(mkItem('')); persist(); render(); const rows = document.querySelectorAll('#main [data-c="' + cat + '"][data-f="label"]'); if (rows.length) rows[rows.length - 1].focus(); break; }
    case 'delrow': {
      if (!m) break;
      const cat = b.dataset.c, i = b.dataset.i, list = cat === 'inc' ? m.income : m.cats[cat], idx = list.findIndex(x => x.id === i);
      if (idx < 0) break;
      const [item] = list.splice(idx, 1);
      showUndo(`השורה ״${item.label || 'ללא שם'}״ נמחקה`, () => { const l = cat === 'inc' ? m.income : m.cats[cat]; l.splice(Math.min(idx, l.length), 0, item); persist(); render(); });
      persist(); render(); break;
    }
    case 'deltx': {
      const rep_ = cl().rep, t0 = rep_.tx.find(x => x.id === b.dataset.t); if (!t0) break;
      const key = [t0.date, t0.desc, t0.amt, t0.kind, t0.type].join('|');
      deleteTx(b.dataset.t);
      showUndo('שורת החיוב נמחקה', () => { const r = cl().rep; r.tx.push(t0); if (r.del && r.del[key]) { r.del[key]--; if (!r.del[key]) delete r.del[key]; } recomputeAll(); persist(); refreshAfterAssign(); });
      refreshAfterAssign(); break;
    }
    case 'undo': { const u = ui.undo; hideUndo(); if (u) u(); break; }
    case 'once': markOnce(b.dataset.t, true); refreshAfterAssign(); break;
    case 'unonce': markOnce(b.dataset.t, false); refreshAfterAssign(); break;
    case 'savetpl': ui.tplArm = true; render(); break;
    case 'savetpl-no': ui.tplArm = false; render(); break;
    case 'savetpl-yes': { if (!c.template && m) { const snap = JSON.parse(JSON.stringify(m)); const CUR = curMap(); (snap.cats.var || []).forEach(it => { const v = CUR[it.label.trim()]; if (v) it.cur = v; }); snap.locked = true; c.template = {savedAt:new Date().toISOString(), month:snap}; } ui.tplArm = false; persist(); render(); break; }
    case 'tpledit': ui.tplEdit = true; render(); break;
    case 'tpledit-done': ui.tplEdit = false; persist(); render(); break;
    case 'tplredo': ui.tplRedo = true; render(); break;
    case 'tplredo-no': ui.tplRedo = false; render(); break;
    case 'tplredo-yes': { const first = c.months[0]; if (c.template && first) { const snap = JSON.parse(JSON.stringify(first)); const CUR = curMap(); (snap.cats.var || []).forEach(it => { const v = CUR[it.label.trim()]; if (v) it.cur = v; }); snap.locked = true; c.template = {savedAt:c.template.savedAt, editedAt:new Date().toISOString(), month:snap}; } ui.tplRedo = false; persist(); render(); break; }
    case 'cubemv': { const o = cubeOrder(); moveCube(b.dataset.id, o.indexOf(b.dataset.id) + +b.dataset.d); break; }
    case 'cubestack': { const st = cubeStacked(); if (st.has(b.dataset.id)) st.delete(b.dataset.id); else st.add(b.dataset.id); ws.cubeStack = [...st]; persist(); render(); break; }
    case 'cuberesort': delete ws.cubeOrder; delete ws.cubeStack; persist(); render(); break;
    case 'delmonth': ui.delArm = true; render(); break;
    case 'delmonth-no': ui.delArm = false; render(); break;
    case 'delmonth-yes': { if (c.months.length > 1) { const idx = c.months.findIndex(x => x.id === c.monthId); c.months.splice(idx, 1); c.monthId = c.months[Math.max(0, idx - 1)].id; } ui.delArm = false; persist(); render(); break; }
    case 'pastego': pasteGo(b.dataset.type); break;
    case 'doimport': doImport(); break;
    case 'nexttable': { const p = ui.pending; if (p) { const n = nextHeader(p.tables[p.ti].rows, p.hdr); if (n > 0) { p.hdr = n; p.map = mapRow(p.tables[p.ti].rows[n]); render(); } } break; }
    case 'cancelimport': ui.pending = null; render(); break;
    case 'delsrc': deleteSource(b.dataset.id); ui.msg = ''; render(); break;
    case 'drill': ui.drill = {cat:b.dataset.cat, sub:b.dataset.sub !== undefined ? b.dataset.sub : undefined, month:b.dataset.month || null, q:'', group:b.dataset.cat === 'uns' || b.dataset.cat === 'all'}; ui.limit = 120; ui.open = {}; renderDrill(); break;
    case 'drillclose': ui.drill = null; renderDrill(); break;
    case 'gtoggle': ui.open[b.dataset.g] = !ui.open[b.dataset.g]; if (ui.drill) renderDrill(); else { const l = document.getElementById('dlist'); if (l) l.innerHTML = listHTML(fixD()); } break;
    case 'more': ui.limit += 150; if (ui.drill) renderDrill(); else { const l = document.getElementById('dlist'); if (l) l.innerHTML = listHTML(fixD()); } break;
    case 'mtoggle': { const R = buildReport(), mo = R.months.find(x => x.k === b.dataset.m); if (mo) { c.rep.excl[mo.k] = mo.incl; persist(); render(); } break; }
    case 'present': document.body.classList.toggle('present'); break;
    case 'xfer': { transfer(b.dataset.cat, b.dataset.sub || '', +b.dataset.v); const y = window.scrollY; ui.msg = `${b.dataset.sub || BY[b.dataset.cat].name}: ${fmt0(+b.dataset.v)} הועבר לתקציב (${BY[b.dataset.cat].name}).`; render(); window.scrollTo(0, y); break; }
    case 'xferall': { transferAll(); const y = window.scrollY; ui.msg = 'כל הסעיפים הועברו לתקציב החודשי (המשתנות מופיעות במצב מצוי).'; render(); window.scrollTo(0, y); break; }
    case 'openbudget': { const m = ensureBudgetMonth(); c.monthId = m.id; c.view = 'month'; ui.msg = ''; persist(); render(); window.scrollTo(0, 0); break; }
    case 'snap': ui.snapArm = +b.dataset.i; render(); break;
    case 'snap-no': ui.snapArm = null; render(); break;
    case 'snap-yes': { const s = snapshots()[+b.dataset.i]; if (s) { try { const st = JSON.parse(s.data); if (validWs(st)) { const cur = localStorage.getItem(KEY2); const list = snapshots(); if (cur) { list.push({t:new Date().toISOString(), data:cur}); while (list.length > 7) list.shift(); localStorage.setItem(SNAPKEY, JSON.stringify(list)); } ws = st; ui.snapArm = null; crossFor = null; persist(); ui.msg = 'הנתונים הוחזרו לגרסה שנבחרה ✓'; render(); } } catch(_) { flash('לא ניתן לשחזר את הגרסה הזו.'); } } break; }
    case 'coachmode': ws.clientMode = false; persist(); render(); break;
    case 'copyjson': { const ta = document.getElementById('bk'); try { await navigator.clipboard.writeText(ta.value); flash('הועתק ✓'); } catch(_) { try { ta.select(); document.execCommand('copy'); flash('הועתק ✓'); } catch(__) { ta.select(); flash('סמני והעתיקי ידנית (Ctrl+C)'); } } break; }
    case 'download': { if (!dl) break; try { await dl.save({filename:'ניהול-תזרים-' + (ui.allClients ? 'כל-הלקוחות' : (c.name || 'לקוח')) + '.json', data:document.getElementById('bk').value}); flash('הקובץ נשמר ✓'); } catch(err) { flash(err && err.code === 'declined' ? 'ההורדה בוטלה' : 'ההורדה לא זמינה, אפשר להשתמש בהעתקה'); } break; }
    case 'import': importText(document.getElementById('imp').value || ''); break;
    case 'reset': ui.resetArm = true; render(); break;
    case 'reset-no': ui.resetArm = false; render(); break;
    case 'reset-yes': { const nc = newClient('לקוח/ה 1'); ws = {v:2, cid:nc.id, clients:[nc]}; ui.resetArm = false; ui.pending = null; ui.drill = null; crossFor = null; persist(); render(); break; }
  }
});

document.addEventListener('dragover', e => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) e.preventDefault(); });
document.addEventListener('drop', e => { if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) { e.preventDefault(); onFiles(e.dataTransfer.files); } });
window.__cf = {
  cl, persist, render, applyClientCats, addClientCat, newMonth, mkItem, uid, num, esc, fmt, fmt0, validWs, newClient, monthTot, EXP, TRK_EXP, BY, NOT_IN_MONTHS,
  addClient:name => { const c = newClient(name); ws.clients.push(c); persist(); return c; },
  selectClient:id => { if (ws.clients.some(x => x.id === id)) { ws.cid = id; ui.panel = null; ui.drill = null; ui.pending = null; crossFor = null; persist(); } },
  setWs:s => { if (!validWs(s)) throw new Error('invalid'); try { const cur = localStorage.getItem(KEY2), list = snapshots(); if (cur) { list.push({t:new Date().toISOString(), data:cur}); while (list.length > 7) list.shift(); localStorage.setItem(SNAPKEY, JSON.stringify(list)); } } catch(_) {} ws = s; crossFor = null; ui.pending = null; ui.drill = null; persist(); render(); },
  workspaceJson:() => JSON.stringify(ws),
  catStr, srcName, mLabel, recomputeIfNeeded,
transfer, ensureBudgetMonth, labelToCat, catLabel, onFiles, buildInstallments, importFile:(buf, fileName, type, name) => { const tables = readTables(buf, fileName); startPending(type, fileName, tables); ui.pending.name = name; const p = ui.pending; const raw = normalizeTable(p.tables[p.ti], p.hdr, p.map, p.type, p.sign, p.all); const r = importRaw(raw, type, name, fileName); ui.pending = null; return r; }, buildReport, crossInfo:() => crossRes, catOf, nextHeader, mapRow, parseDelimited, detectMapping, normalizeTable, parseDate, numParse, readTables, decodeText, mkey, getWs:() => ws};
ensureDatalist();
render();
try { setSaved(localStorage.getItem(KEY2) ? 'נשמר ✓' : ''); } catch(_) {}
if (!(window.claude && window.claude.use)) dl = {save:async ({filename, data}) => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([data], {type:'application/json'})); a.download = filename; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000); }};
try { if (window.claude && window.claude.use) window.claude.use('downloads').then(d => { dl = d; if (cl().view === 'backup') render(); }).catch(() => {}); } catch(_) {}
// the "מצב מצוי" total follows a typed figure once the field is left
document.addEventListener('change', e => { if (e.target && e.target.dataset && e.target.dataset.f === 'curv') { const y = window.scrollY; render(); window.scrollTo(0, y); } });
/* drag a monthly card by its title to move it */
let dragCube = null;
document.addEventListener('dragstart', e => { const h = e.target.closest && e.target.closest('[data-drag]'); if (!h) return; dragCube = h.dataset.drag; e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', dragCube); } catch(_) {} });
document.addEventListener('dragover', e => { if (!dragCube) return; const t = e.target.closest && e.target.closest('[data-cube]'); if (t) { e.preventDefault(); document.querySelectorAll('.cube.dropto').forEach(x => x.classList.remove('dropto')); t.classList.add('dropto'); } });
document.addEventListener('drop', e => { if (!dragCube) return; const t = e.target.closest && e.target.closest('[data-cube]'); if (t) { e.preventDefault(); const o = cubeOrder(); if (t.dataset.cube !== dragCube) moveCube(dragCube, o.indexOf(t.dataset.cube)); } dragCube = null; });
document.addEventListener('dragend', () => { dragCube = null; document.querySelectorAll('.cube.dropto').forEach(x => x.classList.remove('dropto')); });
})();
