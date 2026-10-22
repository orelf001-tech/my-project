// The monthly template the client fills in. Single source of truth for both apps:
// the client form renders from it, and the coach system validates and imports with it.
// Category ids and default items mirror CATS / DEFAULTS in the coach system
// (a test in the coach repo asserts they stay in sync).

export const TEMPLATE_ID = 'monthly-template';
export const TEMPLATE_VERSION = 1;

// kind: 'money'  -> monthly amount
//       'annual' -> client gives a yearly amount, the coach system budgets amount/12
//       'ending' -> monthly amount + month it ends (installments, loans)
export const SECTIONS = [
  { id: 'inc', name: 'הכנסות', color: 'B7D3BE', kind: 'money', income: true,
    title: 'הכנסות חודשיות', hint: 'כמה נכנס לחשבון בכל חודש, בערך. אפשר לשנות את שם השורה (למשל ״משכורת – דנה״).',
    items: ['משכורת', 'משכורת', 'קצבת ילדים', 'עסק', 'הכנסה נוספת'] },
  { id: 'var', name: 'משתנות', color: 'AFC9CB', kind: 'money',
    title: 'הוצאות שוטפות משתנות', hint: 'הערכה של ממוצע חודשי. לא צריך לדייק, אפשר לעגל.',
    items: ['מזון ומכולת', 'בילוי ומסעדות', 'ביגוד והנעלה', 'תחזוקת בית', 'מספרה', 'קוסמטיקה', 'רכישות ברשת', 'פארם'] },
  { id: 'hou', name: 'הוצאות מגורים', color: 'E3CFA6', kind: 'money',
    title: 'מגורים', hint: 'חשבונות דו־חודשיים (חשמל, מים, ארנונה): כתבו את הסכום לחודש אחד.',
    items: ['משכנתא', 'שכר דירה', 'חשמל (חודשי)', 'מים (חודשי)', 'ארנונה (חודשי)', 'גז', 'אינטרנט', 'טלפון', 'כבלים', 'וועד', 'אבטחה'] },
  { id: 'sub', name: 'הוצאות מתחדשות וחודשיות', color: 'CDD6C8', kind: 'money',
    title: 'מנויים והוראות קבע', hint: 'מנויים, אפליקציות, תרומות וכל מה שיורד כל חודש.',
    items: ['נטפליקס', 'ספוטיפיי', 'apple', 'google', 'chat gpt', 'free tv', 'תרומות'] },
  { id: 'trn', name: 'הוצאות תחבורה', color: 'B5D0DA', kind: 'money',
    title: 'תחבורה', hint: '',
    items: ['שטיפת רכב', 'ליסינג / החזר רכב', 'דלק / חשמל', 'חניה', 'כביש 6', 'תחבורה ציבורית'] },
  { id: 'med', name: 'הוצאות רפואיות', color: 'E2C6BE', kind: 'money',
    title: 'בריאות', hint: '',
    items: ['קופת חולים', 'תרופות', 'פסיכולוג', 'טיפול רגשי', 'שיניים'] },
  { id: 'ins', name: 'ביטוחים', color: 'EEDFB8', kind: 'money',
    title: 'ביטוחים', hint: 'ביטוח שמשולם פעם בשנה: חלקו ב־12.',
    items: ['ביטוח דירה', 'ביטוח חיים', 'ביטוח רכב', 'ביטוח בריאות', 'תאונות אישיות'] },
  { id: 'dea', name: 'עסקאות תשלומים פתוחות', color: 'C9D5BC', kind: 'ending',
    title: 'עסקאות בתשלומים', hint: 'קניות בתשלומים שעדיין יורדים: כמה יורד בחודש ומתי זה נגמר.',
    items: [] },
  { id: 'loa', name: 'הלוואות', color: 'D9C3C3', kind: 'ending',
    title: 'הלוואות', hint: 'החזר חודשי ומתי ההלוואה מסתיימת (אם ידוע).',
    items: [] },
  { id: 'sto', name: 'מחסנים והוצאות שנתיות', color: 'BFD0D7', kind: 'annual',
    title: 'הוצאות שנתיות', hint: 'כמה הוצאתם על זה בשנה האחרונה, בערך. המערכת תחלק ל־12.',
    items: ['חופשה שנתית', 'טיפול רכב', 'טסט', 'שמחות ואירועים', 'ימי הולדת', 'אירוח בחגים'] }
];

// Labels that differ from older coach item names but mean the same thing.
export const ALIASES = { 'שטיפת רכב': ['שיפית רכב'] };

export const BY_ID = Object.fromEntries(SECTIONS.map(s => [s.id, s]));

export const LIMITS = { label: 80, note: 1000, rows: 60, amount: 10000000 };

const str = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
const money = v => {
  const n = typeof v === 'number' ? v : parseFloat(String(v == null ? '' : v).replace(/[^\d.\-]/g, ''));
  if (!isFinite(n) || n < 0) return 0;
  return Math.min(LIMITS.amount, Math.round(n * 100) / 100);
};
const month = v => (/^\d{4}-(0[1-9]|1[0-2])$/.test(String(v || '')) ? String(v) : '');

// Anything coming out of a submission is untrusted input: normalize it to a known shape
// before the coach system touches it. Unknown keys are dropped, sizes are capped.
export function normalizeAnswers(raw) {
  const a = raw && typeof raw === 'object' ? raw : {};
  const out = {
    type: TEMPLATE_ID,
    version: TEMPLATE_VERSION,
    name: str(a.name, LIMITS.label),
    period: str(a.period, LIMITS.label),
    note: str(a.note, LIMITS.note),
    sections: {}
  };
  const src = a.sections && typeof a.sections === 'object' ? a.sections : {};
  SECTIONS.forEach(s => {
    const rows = Array.isArray(src[s.id]) ? src[s.id] : [];
    out.sections[s.id] = rows.slice(0, LIMITS.rows).map(r => {
      const row = { label: str(r && r.label, LIMITS.label), amount: money(r && r.amount) };
      if (s.kind === 'ending') row.end = month(r && r.end);
      return row;
    }).filter(r => r.label || r.amount);
  });
  return out;
}

// Monthly value of a row, as it enters the coach system's budget.
export const monthlyOf = (section, row) => (section.kind === 'annual' ? Math.round(row.amount / 12) : row.amount);

export function totals(answers) {
  const per = {};
  let income = 0, expenses = 0;
  SECTIONS.forEach(s => {
    const t = (answers.sections[s.id] || []).reduce((acc, r) => acc + monthlyOf(s, r), 0);
    per[s.id] = t;
    if (s.income) income += t; else expenses += t;
  });
  return { per, income, expenses, balance: income - expenses };
}

// Blank answers for a new form, optionally seeded with the coach's own item list for this client.
export function blankAnswers(prefill) {
  const p = prefill && typeof prefill === 'object' ? prefill : {};
  const ps = p.sections && typeof p.sections === 'object' ? p.sections : {};
  const out = { type: TEMPLATE_ID, version: TEMPLATE_VERSION, name: str(p.name, LIMITS.label), period: '', note: '', sections: {} };
  SECTIONS.forEach(s => {
    const labels = Array.isArray(ps[s.id]) ? ps[s.id].map(l => str(l, LIMITS.label)).filter(Boolean).slice(0, LIMITS.rows) : s.items;
    out.sections[s.id] = labels.map(label => (s.kind === 'ending' ? { label, amount: '', end: '' } : { label, amount: '' }));
  });
  return out;
}
