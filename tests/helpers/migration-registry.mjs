import { readdir } from 'node:fs/promises';

const MIGRATIONS_DIRECTORY = new URL('../../migrations/', import.meta.url);

async function registeredMigrations() {
  return (await readdir(MIGRATIONS_DIRECTORY))
    .filter((file) => /^\d{3}-[a-z0-9-]+\.sql$/.test(file))
    .sort();
}

export async function currentMigrationVersion() {
  const latest = (await registeredMigrations()).at(-1);
  if (!latest) throw new Error('No numbered migration is registered.');
  return latest.slice(0, -4);
}

export async function currentMigrationCount() {
  return (await registeredMigrations()).length;
}
