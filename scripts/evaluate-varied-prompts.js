import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { compose } from '../src/index.js';
import { writeJson } from '../src/export.js';
import { checkCase } from './evaluation-checks.js';
const fixture = JSON.parse(await readFile(new URL('../data/varied-prompt-evaluation.json', import.meta.url), 'utf8'));
const label = process.argv[2] ?? 'current';
if (!/^[a-z0-9-]+$/.test(label)) throw new Error('Use a simple report label.');
const rows = fixture.cases.map((item, i) => {
  try {
    const score = compose(item.prompt, { seed: fixture.seedBase + i });
    return { ...item, interpretation: score.config, ...checkCase(score, item.expect) };
  } catch (error) { return { ...item, passed: false, error: error.message }; }
});
const report = { purpose: fixture.purpose, casesPassed: rows.filter((r) => r.passed).length, total: rows.length, rows };
await mkdir(new URL('../generated_beats/', import.meta.url), { recursive: true });
await writeJson(fileURLToPath(new URL('../generated_beats/varied-prompts-' + label + '.json', import.meta.url)), report);
console.log(report.casesPassed + '/' + report.total + ' cases meet their observable expectations');
for (const row of rows.filter((r) => !r.passed)) console.log(row.id + ': ' + (row.error ?? row.checks.filter((c) => !c.passed).map((c) => c.name + '=' + JSON.stringify(c.actual)).join(', ')));

if (report.casesPassed !== report.total) process.exitCode = 1;
