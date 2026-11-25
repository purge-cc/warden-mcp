#!/usr/bin/env bash
# Builds the two forms of the bridge from the locked dev dependencies, into
# out/: the npm tarball, which is also the Claude Code plugin, and the Claude
# Desktop extension (.mcpb), which carries exactly the files of the tarball.
# Each form is then installed or unpacked on its own and must start.
set -euo pipefail
cd "$(dirname "$0")/.."

scripts/check-pinned.sh
npm ci --prefer-offline --no-audit --no-fund
rm -rf dist dist-test out
npm run build
npm test

version=$(node -p 'require("./package.json").version')
mkdir -p out
npm pack --offline --pack-destination out >/dev/null
# The ./ keeps npm from reading the path as a GitHub user/repo shorthand.
tarball=./out/purgecc-warden-mcp-$version.tgz
extra=$(tar -tzf "$tarball" | grep -vxE 'package/(package\.json|README\.md|CHANGELOG\.md|LICENSE|dist/[a-z]+\.js|\.claude-plugin/plugin\.json|skills/warden/SKILL\.md|skills/warden/references/[a-z-]+\.md)' || true)
[ -z "$extra" ] || { echo "build: unexpected files in the tarball: $extra" >&2; exit 1; }

stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT
tar -xzf "$tarball" -C "$stage"
# The allowlist rejects extra files only; a missing plugin file stops here.
for f in .claude-plugin/plugin.json skills/warden/SKILL.md; do
  [ -f "$stage/package/$f" ] || { echo "build: the tarball has no $f" >&2; exit 1; }
done

# -I keeps Python from importing modules out of the current directory or the
# user site directory, and from reading PYTHON* variables.
mkdir "$stage/mcpb"
cp -R "$stage/package/." manifest.json "$stage/mcpb/"
python3 -I -m zipfile -c "out/warden-mcp-$version.mcpb" "$stage/mcpb/."

# With no settings the bridge stops with exit 2 and the WARDEN_URL line, which
# shows that the copy of each form loads and runs.
starts() {
  local rc=0 err
  err=$(env -i PATH="$PATH" HOME="$stage/home" "$@" 2>&1 </dev/null) || rc=$?
  if [ "$rc" != 2 ] || [[ $err != *"WARDEN_URL is missing"* ]]; then
    echo "build: $* did not start (exit $rc): $err" >&2
    exit 1
  fi
}
npm install --offline --no-audit --no-fund --global --prefix "$stage/prefix" "$tarball" >/dev/null
starts "$stage/prefix/bin/warden-mcp"
python3 -I -m zipfile -e "out/warden-mcp-$version.mcpb" "$stage/unpacked"
node -e '
  const { existsSync, readFileSync } = require("fs");
  const [dir, version] = process.argv.slice(1);
  const manifest = JSON.parse(readFileSync(`${dir}/manifest.json`, "utf8"));
  if (manifest.version !== version || !existsSync(`${dir}/${manifest.server.entry_point}`)) process.exit(1);
' "$stage/unpacked" "$version" || { echo "build: the .mcpb manifest does not match the package" >&2; exit 1; }
starts node "$stage/unpacked/dist/bridge.js"
# The plugin form starts the entry its own plugin.json names, from the package root.
entry=$(node -p 'require(process.argv[1]).mcpServers.warden.args[0]' "$stage/package/.claude-plugin/plugin.json")
root='${CLAUDE_PLUGIN_ROOT}'
starts node "${entry/"$root"/$stage/package}"

echo "build: $tarball (also the Claude Code plugin), out/warden-mcp-$version.mcpb"
