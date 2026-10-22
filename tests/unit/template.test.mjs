import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../../shared/template.js';

test('normalizeAnswers drops junk, caps sizes, keeps known shape', () => {
  const raw = {
    name: 'דנה\u0000<script>', evil: 1,
    sections: {
      inc: [{ label: 'משכורת', amount: '12,500' }, { label: '', amount: '' }, { label: 'x', amount: -5 }],
      dea: [{ label: 'מקרר', amount: 300, end: '2027-03' }, { label: 'ספה', amount: 200, end: '2027-13' }],
      hou: Array.from({ length: 200 }, (_, i) => ({ label: 'שורה ' + i, amount: 1 })),
      zzz: [{ label: 'unknown', amount: 1 }],
      sto: [{ label: 'חופשה', amount: 1e12 }]
    }
  };
  const a = T.normalizeAnswers(raw);
  assert.equal(a.name, 'דנה <script>');
  assert.equal(a.evil, undefined);
  assert.equal(a.sections.zzz, undefined);
  assert.deepEqual(a.sections.inc, [{ label: 'משכורת', amount: 12500 }, { label: 'x', amount: 0 }]);
  assert.deepEqual(a.sections.dea, [{ label: 'מקרר', amount: 300, end: '2027-03' }, { label: 'ספה', amount: 200, end: '' }]);
  assert.equal(a.sections.hou.length, T.LIMITS.rows);
  assert.equal(a.sections.sto[0].amount, T.LIMITS.amount);
  assert.deepEqual(a.sections.var, []);
});

test('normalizeAnswers tolerates garbage input', () => {
  for (const g of [null, 1, 'x', [], { sections: 5 }, { sections: { inc: 'x' } }]) {
    const a = T.normalizeAnswers(g);
    assert.equal(a.type, T.TEMPLATE_ID);
    assert.equal(Object.keys(a.sections).length, T.SECTIONS.length);
  }
});

test('totals: annual items are budgeted monthly', () => {
  const a = T.normalizeAnswers({ sections: { inc: [{ label: 'a', amount: 10000 }], hou: [{ label: 'b', amount: 4000 }], sto: [{ label: 'c', amount: 6000 }] } });
  const t = T.totals(a);
  assert.equal(t.income, 10000);
  assert.equal(t.per.sto, 500);
  assert.equal(t.expenses, 4500);
  assert.equal(t.balance, 5500);
});

test('blankAnswers uses defaults or the coach prefill', () => {
  const d = T.blankAnswers();
  assert.equal(d.sections.hou[0].label, 'משכנתא');
  assert.deepEqual(d.sections.dea, []);
  const p = T.blankAnswers({ name: 'רון', sections: { hou: ['שכר דירה', '', 'ארנונה'], dea: ['מקרר'] } });
  assert.equal(p.name, 'רון');
  assert.deepEqual(p.sections.hou.map(r => r.label), ['שכר דירה', 'ארנונה']);
  assert.deepEqual(p.sections.dea, [{ label: 'מקרר', amount: '', end: '' }]);
  assert.equal(p.sections.var[0].label, 'מזון ומכולת');
});

test('section ids are unique and every section has the fields the form needs', () => {
  const ids = T.SECTIONS.map(s => s.id);
  assert.equal(new Set(ids).size, ids.length);
  T.SECTIONS.forEach(s => {
    assert.ok(['money', 'annual', 'ending'].includes(s.kind));
    assert.ok(s.title && s.name && /^[0-9A-F]{6}$/.test(s.color));
  });
});
