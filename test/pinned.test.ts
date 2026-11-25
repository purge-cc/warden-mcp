import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { tempDir, writeFile } from './helpers.js';

const SCRIPT = fileURLToPath(new URL('../../scripts/check-pinned.sh', import.meta.url));

function marketplace(...sources: unknown[]): string {
  return JSON.stringify({ name: 'purgecc', plugins: sources.map((source) => ({ name: 'warden-mcp', source })) });
}

// The files that carry a value of package.json, all in agreement at 1.2.3.
const BASE: Record<string, string> = {
  'package.json': '{"version": "1.2.3", "engines": {"node": ">=22"}, "wardenMinVersion": "0.45.0"}',
  'package-lock.json': '{"version": "1.2.3", "packages": {"": {"version": "1.2.3"}}}',
  'manifest.json': '{"version": "1.2.3", "compatibility": {"runtimes": {"node": ">=22"}}}',
  '.claude-plugin/plugin.json': '{"name": "warden-mcp", "version": "1.2.3"}',
  '.claude-plugin/marketplace.json': marketplace({ source: 'npm', package: '@purgecc/warden-mcp@1.2.3' }),
  'README.md': '- Warden 0.45.0 or later.\n',
};

// Runs the check on a directory that holds BASE with the given files added
// or replaced.
function check(files: Record<string, string>): number | null {
  const dir = tempDir();
  for (const [name, text] of Object.entries({ ...BASE, ...files })) writeFile(join(dir, name), text, 0o644);
  return spawnSync('bash', [SCRIPT, dir], { encoding: 'utf8' }).status;
}

test('this repository pins one version everywhere', () => {
  const run = spawnSync('bash', [SCRIPT], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
});

test('install text with the exact version passes', () => {
  const text =
    'Run npx -y @purgecc/warden-mcp@1.2.3.\nnpm install -g ./purgecc-warden-mcp-1.2.3.tgz\nwarden-mcp-1.2.3.mcpb\n' +
    'claude plugin marketplace add purge-cc/warden-mcp\n`/plugin marketplace add purge-cc/warden-mcp`\n';
  const json = '{"name": "warden-mcp", "args": ["-y", "@purgecc/warden-mcp@1.2.3"]}';
  assert.equal(check({ 'setup.md': `${text}pnpm dlx @purgecc/warden-mcp@1.2.3\n`, '.claude-plugin/x.json': json }), 0);
});

test('a mention without the exact version fails, in any file', () => {
  for (const text of [
    'npx @purgecc/warden-mcp',
    'npx @purgecc/warden-mcp@latest',
    'npx @purgecc/warden-mcp@^1.2.3',
    'npx @purgecc/warden-mcp@1.2',
    'npx @purgecc/warden-mcp@1.2.4',
    'npm install -g ./purgecc-warden-mcp-1.2.2.tgz',
    'open warden-mcp-1.3.0.mcpb',
  ]) {
    assert.equal(check({ 'setup.md': `${text}\n` }), 1, text);
  }
  assert.equal(check({ '.claude-plugin/x.json': '"@purgecc/warden-mcp"' }), 1);
});

test('a mention of the repository with no ref passes, in any case and command form', () => {
  const text =
    'Add purge-cc/warden-mcp.\nPurge-CC/warden-mcp\nhttps://github.com/purge-cc/warden-mcp\n' +
    'claude plugin marketplace add --scope user "purge-cc/warden-mcp"\n{"repo": "purge-cc/warden-mcp"}\n';
  assert.equal(check({ 'setup.md': text }), 0);
});

test('a mention of the repository with any # ref fails', () => {
  for (const text of [
    'claude plugin marketplace add purge-cc/warden-mcp#v1.2.3',
    '`/plugin marketplace add purge-cc/warden-mcp#v1.2.3`',
    'claude plugin marketplace add purge-cc/warden-mcp#main',
    'claude plugin marketplace add purge-cc/warden-mcp#v1.2.4',
    'claude plugin marketplace add purge-cc/warden-mcp#feature/x',
    'claude plugin marketplace add Purge-CC/warden-mcp#v1.2.3',
    'claude plugin marketplace add https://github.com/purge-cc/warden-mcp#main',
    'claude plugin marketplace add https://github.com/purge-cc/warden-mcp.git#v1.2.3',
    'claude plugin marketplace add git@github.com:Purge-CC/warden-mcp.git#main',
    '{"repo": "purge-cc/warden-mcp#v1.2.3"}',
  ]) {
    assert.equal(check({ 'setup.md': `${text}\n` }), 1, text);
  }
});

test('the unscoped name fails, on a command line and in a JSON args list', () => {
  for (const text of [
    'npx -y warden-mcp',
    'npm add -g warden-mcp',
    'pnpm dlx warden-mcp',
    'yarn dlx warden-mcp',
    'bunx warden-mcp@1.2.3',
    '"args": ["-y", "warden-mcp"]',
    '"args": ["--yes","warden-mcp@1.2.3"]',
    '"args": ["-p", "warden-mcp", "warden-mcp"]',
    '"args": ["--package", "warden-mcp"]',
    '"command": "npx", "args": ["warden-mcp"]',
    '"args": ["dlx", "warden-mcp"]',
  ]) {
    assert.equal(check({ 'setup.md': `${text}\n` }), 1, text);
  }
});

test('a file that repeats a value of package.json and differs fails', () => {
  for (const files of [
    { 'package-lock.json': '{"version": "1.2.4", "packages": {"": {"version": "1.2.3"}}}' },
    { 'package-lock.json': '{"version": "1.2.3", "packages": {"": {"version": "1.2.4"}}}' },
    { 'manifest.json': '{"version": "1.2.4", "compatibility": {"runtimes": {"node": ">=22"}}}' },
    { 'manifest.json': '{"version": "1.2.3", "compatibility": {"runtimes": {"node": ">=20"}}}' },
    { '.claude-plugin/plugin.json': '{"name": "warden-mcp", "version": "1.2.4"}' },
    { 'README.md': '- Warden 0.44.0 or later.\n' },
    { 'README.md': '- Warden 0.45.0 or later; Warden 0.46.0 or later for tier 2.\n' },
    { 'README.md': 'No minimum here.\n' },
  ] as Record<string, string>[]) {
    assert.equal(check(files), 1, JSON.stringify(files));
  }
});

test('a marketplace entry other than the npm package at this version fails', () => {
  const npm = { source: 'npm', package: '@purgecc/warden-mcp@1.2.3' };
  for (const text of [
    marketplace('./plugin'),
    marketplace({ source: 'npm', package: '@purgecc/warden-mcp@1.2.4' }),
    marketplace({ source: 'npm', package: '@purgecc/warden-mcp', version: '1.2.3' }),
    marketplace({ ...npm, registry: 'https://registry.example.com' }),
    marketplace(npm, npm),
    JSON.stringify({ name: 'purgecc', plugins: [{ name: 'warden-mcp', source: npm, strict: false }] }),
    JSON.stringify({ name: 'purgecc', plugins: [{ name: 'warden-mcp', source: npm, mcpServers: {} }] }),
    JSON.stringify({ name: 'purgecc', extra: 1, plugins: [{ name: 'warden-mcp', source: npm }] }),
    JSON.stringify({ name: 'purgecc', plugins: [{ name: 'warden', source: npm }] }),
  ]) {
    assert.equal(check({ '.claude-plugin/marketplace.json': text }), 1, text);
  }
});

test('a top-level marketplace description passes, another extra key fails', () => {
  const plugins = [{ name: 'warden-mcp', source: { source: 'npm', package: '@purgecc/warden-mcp@1.2.3' } }];
  const run = (extra: object) =>
    check({ '.claude-plugin/marketplace.json': JSON.stringify({ name: 'purgecc', ...extra, plugins }) });
  assert.equal(run({ description: 'x' }), 0);
  assert.equal(run({ homepage: 'x' }), 1);
});

test('the marketplace source passes with its keys in another order', () => {
  const text = marketplace({ package: '@purgecc/warden-mcp@1.2.3', source: 'npm' });
  assert.equal(check({ '.claude-plugin/marketplace.json': text }), 0);
});
