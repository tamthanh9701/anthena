#!/usr/bin/env node

/**
 * V2 Migration Runner — Run Postgres DDL migrations for the V2 Evidence Pipeline
 *
 * Usage:
 *   node backend/src/v2/migrations/run-migration.js           # Run all pending migrations
 *   node backend/src/v2/migrations/run-migration.js --dry-run  # Print SQL without executing
 *   node backend/src/v2/migrations/run-migration.js --rollback # Rollback last migration
 *
 * Environment variables:
 *   POSTGRES_HOST     (default: localhost)
 *   POSTGRES_PORT     (default: 5432)
 *   POSTGRES_DB       (default: anthena_v2)
 *   POSTGRES_USER     (default: anthena)
 *   POSTGRES_PASSWORD (default: anthena_secret)
 *   MIGRATIONS_DIR    (default: <script_dir>/)
 */

'use strict';

const fs = require('fs');
const path = require('path');

const MIGRATIONS_DIR = path.resolve(__dirname);
const META_TABLE = '_migrations';
const DRY_RUN = process.argv.includes('--dry-run');
const ROLLBACK = process.argv.includes('--rollback');

// ── Helpers ────────────────────────────────────────────────────────────────

function parseMigrationFile(filename) {
  const match = filename.match(/^(\d+)_(.+)\.sql$/);
  if (!match) return null;
  return { version: parseInt(match[1], 10), name: match[2], filename };
}

async function getAppliedMigrations(client) {
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS ${META_TABLE} (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      filename TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
    const { rows } = await client.query(`SELECT * FROM ${META_TABLE} ORDER BY version`);
    return rows;
  } catch (err) {
    if (err.message && err.message.includes('does not exist')) {
      await client.query(`CREATE TABLE ${META_TABLE} (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        filename TEXT NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
      return [];
    }
    throw err;
  }
}

async function migrate() {
  // ── Scan migration files ──────────────────────────────────────────────────
  const files = fs.readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .map(parseMigrationFile)
    .filter(Boolean)
    .sort((a, b) => a.version - b.version);

  if (files.length === 0) {
    console.log('No migration files found in', MIGRATIONS_DIR);
    process.exit(0);
  }

  console.log(`Found ${files.length} migration(s):`);
  files.forEach(f => console.log(`  ${f.version}: ${f.name}`));

  if (DRY_RUN) {
    console.log('\n--- DRY RUN ---');
    for (const file of files) {
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file.filename), 'utf-8');
      console.log(`\n-- Migration ${file.version}: ${file.name}`);
      console.log(sql);
    }
    console.log('\n--- Dry run complete. No changes applied. ---');
    process.exit(0);
  }

  if (ROLLBACK) {
    console.log('\n--- ROLLBACK ---');
    console.log('Rollback not yet implemented for this migration runner.');
    console.log('Manually run: DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    process.exit(1);
  }

  // ── Connect to Postgres ──────────────────────────────────────────────────
  let client;
  try {
    const { Client } = require('pg');
    client = new Client({
      host: process.env.POSTGRES_HOST || 'localhost',
      port: parseInt(process.env.POSTGRES_PORT, 10) || 5432,
      database: process.env.POSTGRES_DB || 'anthena_v2',
      user: process.env.POSTGRES_USER || 'anthena',
      password: process.env.POSTGRES_PASSWORD || 'anthena_secret',
    });
    await client.connect();
    console.log('Connected to Postgres:', client.database);
  } catch (err) {
    console.error('Failed to connect to Postgres:', err.message);
    console.error('Set POSTGRES_HOST, POSTGRES_PORT, POSTGRES_DB, POSTGRES_USER, POSTGRES_PASSWORD');
    process.exit(1);
  }

  try {
    // ── Get applied migrations ───────────────────────────────────────────
    const applied = await getAppliedMigrations(client);
    const appliedVersions = new Set(applied.map(r => r.version));
    console.log(`\nApplied migrations: ${applied.length}`);

    // ── Run pending migrations ───────────────────────────────────────────
    let ran = 0;
    for (const file of files) {
      if (appliedVersions.has(file.version)) {
        console.log(`  SKIP ${file.version}: already applied`);
        continue;
      }

      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file.filename), 'utf-8');
      console.log(`  RUN  ${file.version}: ${file.name}...`);

      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query(
          `INSERT INTO ${META_TABLE} (version, name, filename) VALUES ($1, $2, $3)`,
          [file.version, file.name, file.filename]
        );
        await client.query('COMMIT');
        console.log(`       Done.`);
        ran++;
      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`       FAILED: ${err.message}`);
        process.exit(1);
      }
    }

    if (ran === 0) {
      console.log('No pending migrations. Database is up to date.');
    } else {
      console.log(`\nApplied ${ran} migration(s) successfully.`);
    }
  } finally {
    await client.end();
  }
}

migrate().catch(err => {
  console.error('Migration runner error:', err);
  process.exit(1);
});