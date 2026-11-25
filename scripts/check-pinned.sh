#!/usr/bin/env bash
# Fails when text a user copies names @purgecc/warden-mcp without the exact
# version of this package, when any mention of purge-cc/warden-mcp carries a
# ref after a #, or when a file that repeats a value of package.json (the
# version, the Node range, the Warden minimum, the plugin source) disagrees.
# Install text pins an exact version, never a range or latest: a later publish
# under the scope would otherwise reach every user at once. The marketplace is
# added with no ref: it follows the default branch of the repository,
# which moves only at a release, after the npm version it pins is published.
# Usage: scripts/check-pinned.sh [DIR]   (DIR defaults to this repository)
set -euo pipefail
cd "${1:-$(dirname "$0")/..}"

version=$(node -p 'require("./package.json").version')
fail=0
bad() {
  echo "check-pinned: $*" >&2
  fail=1
}
# Every file except the package files, the tests and this script, which name
# the package without a version on purpose.
scan() {
  local ci=-E
  [ "$1" = -i ] && { ci=-iE; shift; }
  grep -rno $ci --exclude-dir={.git,node_modules,dist,dist-test,out,test} \
    --exclude={package.json,package-lock.json,check-pinned.sh,check-warden-texts.sh} "$1" . || true
}

node -e '
  const read = (file) => JSON.parse(require("fs").readFileSync(file, "utf8"));
  const pkg = read("package.json");
  const lock = read("package-lock.json");
  const manifest = read("manifest.json");
  const plugin = read(".claude-plugin/plugin.json");
  const market = read(".claude-plugin/marketplace.json");
  const plugins = market.plugins;
  const { isDeepStrictEqual } = require("util");
  const outside = (obj, allowed) => Object.keys(obj ?? {}).filter((k) => !allowed.includes(k));
  for (const [what, extra] of [
    [".claude-plugin/marketplace.json top-level keys", outside(market, ["name", "owner", "description", "plugins"])],
    [".claude-plugin/marketplace.json plugins[0] keys", outside(plugins?.[0], ["name", "source", "description"])],
  ]) {
    if (extra.length) {
      console.error(`check-pinned: ${what} include ${extra.join(", ")}`);
      process.exitCode = 1;
    }
  }
  if (!isDeepStrictEqual(plugins?.[0]?.source, { source: "npm", package: `@purgecc/warden-mcp@${pkg.version}` })) {
    console.error("check-pinned: .claude-plugin/marketplace.json plugins[0].source is not the npm package at this version");
    process.exitCode = 1;
  }
  for (const [what, got, want] of [
    ["package-lock.json version", lock.version, pkg.version],
    ["package-lock.json packages[\"\"].version", lock.packages?.[""]?.version, pkg.version],
    ["manifest.json version", manifest.version, pkg.version],
    [".claude-plugin/plugin.json version", plugin.version, pkg.version],
    ["the plugin count of .claude-plugin/marketplace.json", plugins?.length, 1],
    [".claude-plugin/marketplace.json plugins[0].name", plugins?.[0]?.name, plugin.name],
    ["manifest.json compatibility.runtimes.node", manifest.compatibility?.runtimes?.node, pkg.engines?.node],
  ]) {
    if (got !== want) {
      console.error(`check-pinned: ${what} is ${got}, expected ${want}`);
      process.exitCode = 1;
    }
  }
' || fail=1

min=$(node -p 'require("./package.json").wardenMinVersion')
stated=$(grep -oE 'Warden [0-9]+\.[0-9]+\.[0-9]+ or later' README.md | sort -u || true)
[ "$stated" = "Warden $min or later" ] ||
  bad "README.md states ${stated:-no Warden minimum}, package.json has wardenMinVersion $min"

while IFS= read -r hit; do
  [[ $hit == *":@purgecc/warden-mcp@$version" ]] || bad "not pinned to $version: $hit"
done < <(scan '@purgecc/warden-mcp(@[0-9A-Za-z.^~<>=*+-]*[0-9A-Za-z*])?')

while IFS= read -r hit; do
  [[ $hit == *":purgecc-warden-mcp-$version.tgz" || $hit == *":warden-mcp-$version.mcpb" ]] ||
    bad "file name not at $version: $hit"
done < <(scan '(purgecc-)?warden-mcp-[0-9][0-9A-Za-z.+-]*\.(tgz|mcpb)')

# Every mention of the repository, in any case and in any command form, has no
# ref: the marketplace follows the default branch.
# shortcut: a page anchor on a plain link (https://github.com/purge-cc/warden-mcp#readme)
# fails too; exempt anchors if the README ever needs one.
while IFS= read -r hit; do
  bad "repository mention has a ref; the marketplace follows the default branch: $hit"
done < <(scan -i 'purge-cc/warden-mcp(\.git)?#[^[:space:]]*')

# The unscoped name warden-mcp on npm belongs to an unrelated project, which
# would get the token from the environment. Caught on a command line and in
# a JSON args list: first in the list, or after an option such as "-y" or a
# subcommand such as "dlx". An MCP client starts npx with no terminal, so npx
# installs without asking.
while IFS= read -r hit; do
  bad "unscoped package name: $hit"
done < <(scan '(npx|bunx|(pnpm|yarn) dlx|npm (install|i|add|exec|x))( +-[^ ]+)* +warden-mcp|"-[^"]*"( *, *"-[^"]*")* *, *"warden-mcp|\[ *"warden-mcp|"(dlx|x|exec|add|install|i)" *, *"warden-mcp')

[ "$fail" = 0 ] && echo "check-pinned: every mention pins $version"
exit "$fail"
