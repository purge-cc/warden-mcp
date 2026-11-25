import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

test('check-warden-texts.sh passes on matching texts and fails when Warden drops a command', () => {
  const fake = mkdtempSync(join(tmpdir(), 'warden-texts-'));
  try {
    cpSync(join(root, 'skills/warden'), join(fake, 'pkg/agent-skill/warden'), { recursive: true });
    const dir = join(fake, 'src/cli/commands/agent');
    mkdirSync(dir, { recursive: true });
    const lines = [
      'claude plugin marketplace add purge-cc/warden-mcp',
      'claude plugin install warden-mcp@purgecc',
      '/plugin marketplace add purge-cc/warden-mcp',
      '/plugin install warden-mcp@purgecc',
      'cat | claude plugin configure warden-mcp@purgecc --values-stdin',
      'claude mcp add --scope user warden -- npx -y {MCP_PACKAGE}@{MCP_PACKAGE_VERSION}',
      `MCP_PACKAGE: &str = "${pkg.name}"`,
      `MCP_PACKAGE_VERSION: &str = "${pkg.version}"`,
    ];
    const setup = join(dir, 'setup.rs');
    const run = () => spawnSync('bash', ['scripts/check-warden-texts.sh', fake], { cwd: root, encoding: 'utf8' });
    writeFileSync(setup, lines.join('\n') + '\n');
    const ok = run();
    assert.equal(ok.status, 0, ok.stderr);
    writeFileSync(setup, lines.filter((l) => !l.includes('configure')).join('\n') + '\n');
    const bad = run();
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /configure warden-mcp@purgecc/);
  } finally {
    rmSync(fake, { recursive: true, force: true });
  }
});
