import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compose } from '../src/index.js';
import { checkCase } from '../scripts/evaluation-checks.js';
const fixture = JSON.parse(readFileSync(new URL('../data/varied-prompt-evaluation.json', import.meta.url), 'utf8'));

test('the frozen 50-prompt development set preserves explicit constraints without forcing vague genres', () => {
  assert.equal(fixture.cases.length, 50);
  assert.equal(new Set(fixture.cases.map((r) => r.id)).size, 50);
  fixture.cases.forEach((row, i) => {
    if (row.level === 'vague') assert.equal(row.expect.intent, undefined);
    const score = compose(row.prompt, { seed: fixture.seedBase + i });
    assert.equal(score.config.bars, 32);
    const result = checkCase(score, row.expect);
    assert.ok(result.passed, row.id + ': ' + JSON.stringify(result.checks.filter((c) => !c.passed)));
  });
});
