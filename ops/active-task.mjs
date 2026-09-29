import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function activeTaskFromText(tasks) {
  const entries = [...tasks.matchAll(/^- \[([ x])\] (PR-\d{2})\s+—/gm)];
  const ids = entries.map((entry) => entry[2]);
  const cursor = tasks.match(/^Active cursor:\s*(PR-\d{2}|COMPLETE)\b/m)?.[1];
  const firstOpen = entries.find((entry) => entry[1] === ' ')?.[2] ?? null;

  if (entries.length !== 19 || new Set(ids).size !== entries.length || !cursor || cursor !== (firstOpen ?? 'COMPLETE')) {
    throw new Error(`Invalid task pointer: cursor=${cursor ?? 'missing'}, first open=${firstOpen ?? 'missing'}, PR entries=${entries.length}, unique=${new Set(ids).size}. Review TASKS.md checkboxes and passing receipts.`);
  }
  return firstOpen;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const tasks = readFileSync(new URL('../TASKS.md', import.meta.url), 'utf8');
    const firstOpen = activeTaskFromText(tasks);
    if (firstOpen) {
      const line = tasks.slice(0, tasks.indexOf(`- [ ] ${firstOpen} —`)).split('\n').length;
      console.log(`${firstOpen} is the first open implementation task at TASKS.md:${line}.`);
    } else {
      console.log('All implementation PRs are checked. Review the separate release-gate ledgers.');
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
