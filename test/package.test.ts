import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const json = (path: string) => JSON.parse(readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8'));
const pkg = json('package.json');

test('the package has no runtime dependencies', () => {
  for (const key of ['dependencies', 'optionalDependencies', 'peerDependencies', 'bundleDependencies']) {
    assert.equal(pkg[key], undefined, key);
  }
});

test('the only dev dependencies are typescript and @types/node, at exact versions', () => {
  assert.deepEqual(Object.keys(pkg.devDependencies).sort(), ['@types/node', 'typescript']);
  for (const version of Object.values(pkg.devDependencies)) {
    assert.match(String(version), /^\d+\.\d+\.\d+$/);
  }
});

test('the package declares its name, bin, licence, Node and Warden minimums', () => {
  assert.equal(pkg.name, '@purgecc/warden-mcp');
  assert.deepEqual(pkg.bin, { 'warden-mcp': 'dist/bridge.js' });
  assert.equal(pkg.license, 'Apache-2.0');
  assert.equal(pkg.type, 'module');
  assert.equal(pkg.engines.node, '>=22');
  assert.match(pkg.wardenMinVersion, /^\d+\.\d+\.\d+$/);
});

test('the .mcpb and the plugin start the packaged bridge with the three settings, the token marked sensitive', () => {
  const manifest = json('manifest.json');
  const plugin = json('.claude-plugin/plugin.json');
  const server = plugin.mcpServers.warden;
  const keys = { WARDEN_URL: 'warden_url', WARDEN_TOKEN: 'warden_token', WARDEN_TLS_SHA256: 'warden_tls_sha256' };
  const env = Object.fromEntries(Object.entries(keys).map(([name, key]) => [name, `\${user_config.${key}}`]));
  assert.equal(manifest.server.entry_point, pkg.bin['warden-mcp']);
  assert.deepEqual(manifest.server.mcp_config.args, ['${__dirname}/dist/bridge.js']);
  assert.deepEqual(manifest.server.mcp_config.env, env);
  assert.deepEqual(server.args, ['${CLAUDE_PLUGIN_ROOT}/dist/bridge.js']);
  assert.deepEqual(server.env, env);
  for (const config of [manifest.user_config, plugin.userConfig]) {
    assert.deepEqual(Object.keys(config).sort(), Object.values(keys).sort());
    assert.deepEqual(
      Object.keys(config).filter((key) => config[key].sensitive),
      ['warden_token'],
    );
  }
  assert.equal(manifest.license, 'Apache-2.0');
  assert.equal(plugin.license, 'Apache-2.0');
});

test('the repository root is the purgecc marketplace, with the plugin from npm at this version', () => {
  const marketplace = json('.claude-plugin/marketplace.json');
  assert.equal(marketplace.name, 'purgecc');
  assert.equal(marketplace.plugins.length, 1);
  const [entry] = marketplace.plugins;
  assert.equal(entry.name, json('.claude-plugin/plugin.json').name);
  assert.deepEqual(entry.source, { source: 'npm', package: `${pkg.name}@${pkg.version}` });
});

// dist/ is left out: npm test alone does not build it, scripts/build.sh checks it.
test('the package root is the plugin root, without the marketplace file', () => {
  const root = fileURLToPath(new URL('../..', import.meta.url));
  const run = spawnSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts', '--offline'], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(run.status, 0, run.stderr);
  const paths = JSON.parse(run.stdout)[0].files.map((f: { path: string }) => f.path);
  for (const path of ['.claude-plugin/plugin.json', 'skills/warden/SKILL.md']) {
    assert.ok(paths.includes(path), path);
  }
  assert.ok(!paths.includes('.claude-plugin/marketplace.json'));
  assert.ok(!paths.includes('.mcp.json'));
});
