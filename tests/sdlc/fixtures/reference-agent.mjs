import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const context = JSON.parse(await readFile(process.env.ORGWARD_CONTEXT_PATH, 'utf8'));
await mkdir('src', { recursive: true });
await writeFile(path.join('src', 'bounded-change.json'), `${JSON.stringify({ workItem: context.workItem.id, requirements: context.contextPackage.requirements, contextHash: context.contentHash }, null, 2)}\n`);
process.stdout.write(`implemented ${context.workItem.id}\n`);
