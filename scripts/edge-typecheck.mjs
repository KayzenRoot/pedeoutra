#!/usr/bin/env node
/** Typecheck das Edge Functions (Deno). Usa deno local ou npx. */
import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const FUNCTIONS_DIR = join(ROOT, 'supabase', 'functions')

const entrypoints = readdirSync(FUNCTIONS_DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && !entry.name.startsWith('_'))
  .map((entry) => join('supabase', 'functions', entry.name, 'index.ts'))
  .sort()

if (entrypoints.length === 0) {
  console.error('Nenhuma Edge Function encontrada.')
  process.exit(1)
}

const hasDeno = spawnSync('deno', ['--version'], { encoding: 'utf8', shell: process.platform === 'win32' })
const command = hasDeno.status === 0 ? 'deno' : process.platform === 'win32' ? 'npx.cmd' : 'npx'
const args = hasDeno.status === 0 ? ['check', ...entrypoints] : ['-y', 'deno', 'check', ...entrypoints]

console.log(`Verificando ${entrypoints.length} Edge Functions com ${command}…`)
const result = spawnSync(command, args, {
  cwd: ROOT,
  stdio: 'inherit',
  shell: process.platform === 'win32' && command === 'npx.cmd',
})

if (result.status !== 0) process.exit(result.status ?? 1)
console.log('PASS Edge Functions typecheck')
