import test from 'node:test';
import assert from 'node:assert/strict';
import { compose } from '../src/index.js';
import { planIndieVariations, checkIndieVariation } from '../scripts/lib/indie-variations.js';


test('20 seeded recipes cover different actual sounds, keys, forms and phrases with replay',()=>{
  const rows=planIndieVariations('palette-regression');
  assert.deepEqual(rows,planIndieVariations('palette-regression'));
  assert.notDeepEqual(rows,planIndieVariations('another-plan'));
  assert.equal(rows.length,20); assert.equal(new Set(rows.map(r=>r.seed)).size,20);
  for(const row of rows){
    const score=compose(row.prompt,{seed:row.seed,...row.options});
    checkIndieVariation(row,score);
    assert.deepEqual(score,compose(row.prompt,{seed:row.seed,...row.options}));
  }
  assert.equal(new Set(rows.map(r=>r.expect.bass)).size,8);
  assert.equal(new Set(rows.map(r=>r.expect.harmony)).size,10);
  assert.equal(new Set(rows.map(r=>r.expect.style)).size,6);
  assert.equal(new Set(rows.map(r=>r.expect.form)).size,5);
  assert.equal(new Set(rows.map(r=>r.expect.root)).size,12);
});

test('electric bass guitar is one instrument, without a stray acoustic guitar match',()=>{
  const score=compose('indie pop with electric guitar and electric bass guitar',{seed:8});
  assert.equal(score.config.synthProfile,'electric_guitar');
  assert.equal(score.config.bassProfile,'electric_bass');
  assert(!score.parts.some(p=>p.profile==='acoustic_guitar'));
  const negative=compose('indie pop without electric bass guitar');
  assert.equal(negative.bass.length,0);
});
