export const RESTORE_GUARD_SCHEMA = 'orgward_internal_restore_fence_5d93b2a1c4e84744';
export const RESTORE_GUARD_TABLE = 'active_restore';

export async function hasRestoreGuard(client) {
  const result = await client.query('select exists(select 1 from pg_namespace where nspname=$1) as present', [RESTORE_GUARD_SCHEMA]);
  return result.rows[0].present;
}

export async function assertNoRestoreGuard(client, code = 'RESTORE_RECOVERY_GUARD') {
  if (await hasRestoreGuard(client)) {
    throw Object.assign(new Error('A database restore has an unresolved recovery guard; startup or recovery was refused.'), {
      code, statusCode: 503, retryable: false,
    });
  }
}

export async function createRestoreGuard(client, { restoreId, backupSha256, targetIdentity }) {
  await client.query('begin');
  try {
    await assertNoRestoreGuard(client);
    await client.query(`create schema "${RESTORE_GUARD_SCHEMA}"`);
    await client.query(`create table "${RESTORE_GUARD_SCHEMA}"."${RESTORE_GUARD_TABLE}" (
      singleton boolean primary key default true check (singleton),
      restore_id uuid not null unique,
      backup_sha256 text not null check (backup_sha256 ~ '^[a-f0-9]{64}$'),
      target_identity jsonb not null check (jsonb_typeof(target_identity) = 'object'),
      created_at timestamptz not null default now()
    )`);
    await client.query(`insert into "${RESTORE_GUARD_SCHEMA}"."${RESTORE_GUARD_TABLE}"
      (singleton, restore_id, backup_sha256, target_identity) values (true, $1::uuid, $2, $3::jsonb)`,
    [restoreId, backupSha256, JSON.stringify(targetIdentity)]);
    await client.query('commit');
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  }
}

export async function removeRestoreGuard(client, { restoreId, backupSha256, targetIdentity }) {
  await client.query('begin');
  try {
    const guarded = await client.query(`select restore_id from "${RESTORE_GUARD_SCHEMA}"."${RESTORE_GUARD_TABLE}"
      where singleton=true and restore_id=$1::uuid and backup_sha256=$2 and target_identity=$3::jsonb for update`,
    [restoreId, backupSha256, JSON.stringify(targetIdentity)]);
    if (guarded.rowCount !== 1) {
      throw Object.assign(new Error('The restore guard no longer matches this verified restore.'), { code: 'RESTORE_GUARD_MISMATCH' });
    }
    await client.query(`drop table "${RESTORE_GUARD_SCHEMA}"."${RESTORE_GUARD_TABLE}"`);
    await client.query(`drop schema "${RESTORE_GUARD_SCHEMA}"`);
    await client.query('commit');
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  }
}
