import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, describe, expect, it } from 'vitest';

const DRIZZLE_DIR = resolve(import.meta.dirname, '../../drizzle');

describe('migration files', () => {
  it('drizzle directory exists', () => {
    expect(existsSync(DRIZZLE_DIR)).toBe(true);
  });

  it('has at least one migration', () => {
    const files = readdirSync(DRIZZLE_DIR).filter((f) => f.endsWith('.sql'));
    expect(files.length).toBeGreaterThanOrEqual(1);
  });

  it('migrations are sequentially numbered', () => {
    const files = readdirSync(DRIZZLE_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort();
    for (let i = 0; i < files.length; i++) {
      const prefix = files[i].split('_')[0];
      expect(prefix).toBe(String(i).padStart(4, '0'));
    }
  });

  it('meta directory exists with journal', () => {
    const metaDir = resolve(DRIZZLE_DIR, 'meta');
    expect(existsSync(metaDir)).toBe(true);
    expect(existsSync(resolve(metaDir, '_journal.json'))).toBe(true);
  });
});

describe('migration replay on clean database', () => {
  let pglite: PGlite;

  afterAll(async () => {
    await pglite?.close();
  });

  it('all migrations replay successfully on a clean PGlite instance', async () => {
    pglite = new PGlite();

    const files = readdirSync(DRIZZLE_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    for (const file of files) {
      const sqlContent = readFileSync(resolve(DRIZZLE_DIR, file), 'utf-8');
      const statements = sqlContent
        .split('--> statement-breakpoint')
        .map((s) => s.trim())
        .filter(Boolean);

      for (const stmt of statements) {
        await pglite.exec(stmt);
      }
    }

    const result = await pglite.query<{ tablename: string }>(
      "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename"
    );
    const tables = result.rows.map((r) => r.tablename);

    expect(tables).toContain('users');
    expect(tables).toContain('projects');
    expect(tables).toContain('tasks');
    expect(tables).toContain('runs');
    expect(tables).toContain('agents');
    expect(tables).toContain('run_events');
    expect(tables).toContain('sandboxes');
    expect(tables).toContain('vault_entries');
  });
});
