import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as P from '../../shared/portal-core.js';

const item = (id, label, extra = {}) => ({ id, label, budget: 0, paid: 0, w: [0, 0, 0, 0, 0], note: '', ...extra });
const month = (id, label, cats = {}, income = [{ id: 'i1', label: 'משכורת', amount: 0 }]) => ({ id, label, income, cats });
const book = months => P.normalizeBook({ months });
const clone = x => JSON.parse(JSON.stringify(x));

test('bookFromMonths keeps shared fields only and skips locked months', () => {
  const b = P.bookFromMonths([
    { id: 'm0', label: 'תבנית', locked: true, income: [], cats: {} },
    { id: 'm1', label: 'אוקטובר 2026', baseline: true, income: [{ id: 'i', label: 'משכורת', amount: 9000, cur: 1 }],
      cats: { var: [item('a', 'מזון', { budget: 2000, w: [500, 400], cur: 3 })], trn: [item('t', 'דלק', { paid: 300 })], hou: [item('h', 'שכר דירה', { budget: 4000, paid: 4000 })] } }
  ]);
  assert.equal(b.months.length, 1);
  const m = b.months[0];
  assert.deepEqual(m.income[0], { id: 'i', label: 'משכורת', amount: 9000 });
  assert.equal(m.cats.var[0].paid, 900);
  assert.equal(m.cats.var[0].cur, undefined);
  assert.deepEqual(m.cats.trn[0].w, [300, 0, 0, 0, 0], 'monthly paid on a weekly category moves to week 1');
  assert.equal(m.cats.hou[0].paid, 4000);
  assert.deepEqual(m.cats.ins, []);
});

test('three-way merge: each side keeps its own edits', () => {
  const base = book([month('m1', 'אוקטובר', { var: [item('a', 'מזון', { budget: 2000 })], hou: [item('h', 'שכר דירה', { budget: 4000 })] })]);
  const coach = clone(base), client = clone(base);
  coach.months[0].cats.var[0].budget = 2500;                // coach changes a budget
  coach.months[0].cats.hou.push(item('h2', 'ארנונה', { budget: 600 }));
  client.months[0].cats.var[0].w = [450, 0, 0, 0, 0];       // client fills week 1
  client.months[0].cats.hou[0].paid = 4000;
  client.months.push(month('m2', 'נובמבר', { var: [item('b', 'מזון')] }));
  for (const [side, l, r] of [['coach', coach, client], ['client', client, coach]]) {
    const m = P.mergeBooks(base, l, r, side);
    assert.equal(m.months.length, 2, side);
    const a = m.months[0].cats.var[0];
    assert.deepEqual([a.budget, a.w[0], a.paid], [2500, 450, 450], side);
    assert.deepEqual(m.months[0].cats.hou.map(x => [x.id, x.budget, x.paid]), [['h', 4000, 4000], ['h2', 600, 0]], side);
    assert.equal(m.months[1].label, 'נובמבר', side);
  }
});

test('three-way merge: both changed the same field -> actuals to client, plan to coach', () => {
  const base = book([month('m1', 'אוקטובר', { hou: [item('h', 'שכר דירה', { budget: 4000, paid: 0 })] })]);
  const coach = clone(base), client = clone(base);
  coach.months[0].cats.hou[0].paid = 3900; coach.months[0].cats.hou[0].budget = 4100; coach.months[0].cats.hou[0].label = 'שכ״ד';
  client.months[0].cats.hou[0].paid = 4000; client.months[0].cats.hou[0].budget = 4500; client.months[0].cats.hou[0].label = 'דירה';
  for (const [side, l, r] of [['coach', coach, client], ['client', client, coach]]) {
    const h = P.mergeBooks(base, l, r, side).months[0].cats.hou[0];
    assert.deepEqual([h.paid, h.budget, h.label], [4000, 4100, 'שכ״ד'], side);
  }
});

test('three-way merge: deletions', () => {
  const base = book([month('m1', 'אוקטובר', { sub: [item('s1', 'נטפליקס', { budget: 50 }), item('s2', 'ספוטיפיי', { budget: 20 })] })]);
  const coach = clone(base), client = clone(base);
  client.months[0].cats.sub = client.months[0].cats.sub.filter(x => x.id !== 's2');   // client cancels spotify
  coach.months[0].cats.sub[0].budget = 60;
  const m = P.mergeBooks(base, coach, client, 'coach');
  assert.deepEqual(m.months[0].cats.sub.map(x => [x.id, x.budget]), [['s1', 60]]);
  // a row edited on one side survives deletion on the other
  const c2 = clone(base), k2 = clone(base);
  c2.months[0].cats.sub[1].budget = 25;
  k2.months[0].cats.sub = k2.months[0].cats.sub.filter(x => x.id !== 's2');
  assert.equal(P.mergeBooks(base, c2, k2, 'coach').months[0].cats.sub.length, 2);
});

test('merge with no base (first sync) keeps everything', () => {
  const a = book([month('m1', 'אוקטובר')]), b = book([month('m2', 'נובמבר')]);
  assert.deepEqual(P.mergeBooks(null, a, b, 'coach').months.map(m => m.id), ['m1', 'm2']);
});

test('new month copies rows and budgets with empty actuals', () => {
  const b = book([month('m1', 'אוקטובר 2026', { var: [item('a', 'מזון', { budget: 2000, w: [500, 0, 0, 0, 0] })], ins: [item('x', 'ביטוח רכב', { budget: 300, paid: 300 })] }, [{ id: 'i', label: 'משכורת', amount: 9000 }])]);
  const label = P.nextMonthLabel(b);
  assert.equal(label, 'נובמבר 2026');
  const m = P.newMonthFrom(b, label);
  assert.notEqual(m.cats.var[0].id, 'a');
  assert.deepEqual([m.cats.var[0].label, m.cats.var[0].budget, m.cats.var[0].paid, m.cats.var[0].w], ['מזון', 2000, 0, [0, 0, 0, 0, 0]]);
  assert.deepEqual([m.cats.ins[0].budget, m.cats.ins[0].paid], [300, 0]);
  assert.deepEqual([m.income[0].label, m.income[0].amount], ['משכורת', 0]);
  b.months[0].label = 'דצמבר 2026';
  assert.equal(P.nextMonthLabel(b), 'ינואר 2027');
  assert.equal(P.nextMonthLabel(book([]), new Date('2026-10-25')), 'אוקטובר 2026');
});

test('monthTotals', () => {
  const t = P.monthTotals(book([month('m', 'x', { var: [item('a', 'מזון', { budget: 2000, w: [500, 300, 0, 0, 0] })], hou: [item('h', 'שכר דירה', { budget: 4000, paid: 4000 })] }, [{ id: 'i', label: 'm', amount: 10000 }])]).months[0]);
  assert.deepEqual([t.inc, t.budget, t.paid, t.left], [10000, 6000, 4800, 5200]);
});
