#!/usr/bin/env bash
# Checks the commands this repository and Warden print against each other.
# Usage: scripts/check-warden-texts.sh WARDEN_DIR
# Exit 0: all hold; 1: a difference (one line each on stderr); 2: usage error.
set -euo pipefail
cd "$(dirname "$0")/.."

[ $# -eq 1 ] || { echo "usage: $0 WARDEN_DIR" >&2; exit 2; }
w=$1
setup=$w/src/cli/commands/agent/setup.rs
cc=skills/warden/references/client-claude-code.md
for f in "$setup" "$w/pkg/agent-skill/warden/SKILL.md" "$cc" README.md package.json; do
  [ -f "$f" ] || { echo "check-warden-texts: missing file $f" >&2; exit 2; }
done

P=$(node -p 'require("./package.json").name')
V=$(node -p 'require("./package.json").version')
fail=0
bad() { echo "check-warden-texts: $*" >&2; fail=1; }
has() { grep -qF -- "$2" "$1" || bad "$3: $1 lacks: $2"; }

# 1. The skill is a copy of Warden's.
d=$(diff -r "$w/pkg/agent-skill/warden" skills/warden 2>&1 || true)
[ -z "$d" ] || bad "skill copy differs: $(printf '%s' "$d" | head -5 | tr '\n' ';')"

# 2. The printed commands are in the README and the Claude Code reference.
five=(
  'claude plugin marketplace add purge-cc/warden-mcp'
  'claude plugin install warden-mcp@purgecc'
  '/plugin marketplace add purge-cc/warden-mcp'
  '/plugin install warden-mcp@purgecc'
  'cat | claude plugin configure warden-mcp@purgecc --values-stdin'
)
npx_line="claude mcp add --scope user warden -- npx -y $P@$V"
for c in "${five[@]}" "$npx_line"; do
  has README.md "$c" printed-command
  has "$cc" "$c" printed-command
done

# 3. Warden prints the same.
for c in "${five[@]}"; do has "$setup" "$c" warden-text; done
has "$setup" 'claude mcp add --scope user warden -- npx -y {MCP_PACKAGE}@{MCP_PACKAGE_VERSION}' warden-text
has "$setup" "MCP_PACKAGE: &str = \"$P\"" warden-text
has "$setup" "MCP_PACKAGE_VERSION: &str = \"$V\"" warden-text

# 4. The update commands.
for c in 'claude plugin marketplace update purgecc' 'claude plugin update warden-mcp@purgecc'; do
  has README.md "$c" update-command
  has "$cc" "$c" update-command
done

# 5. No other plugin command form.
allowed=$(cat <<'EOF'
claude plugin marketplace add purge-cc/warden-mcp
claude plugin install warden-mcp@purgecc
/plugin marketplace add purge-cc/warden-mcp
/plugin install warden-mcp@purgecc
claude plugin configure warden-mcp@purgecc --values-stdin
claude plugin marketplace update purgecc
claude plugin update warden-mcp@purgecc
claude plugin uninstall warden-mcp@purgecc
claude plugin marketplace remove purgecc
EOF
)
pc='(claude[[:space:]]+plugins?|/plugin)'
# shortcut: a form is read up to a backtick or the line end; a form split over two lines is not seen.
while IFS= read -r hit; do
  file=${hit%%:*}; rest=${hit#*:}; rest=${rest#*:}
  form=$(printf '%s' "$rest" | sed -E 's/[[:space:]]+/ /g; s/ $//')
  grep -qxF -- "$form" <<<"$allowed" || bad "plugin command form not allowed: $file: $form"
done < <(grep -rnoE --exclude-dir=node_modules \
  "$pc[[:space:]]+(marketplace[[:space:]]+[^[:space:]\`]+|[^[:space:]\`]+)[[:space:]]+[^\`]+" \
  README.md CHANGELOG.md skills || true)
# --marketplace after a plugin command on one line.
while IFS= read -r hit; do
  bad "plugin command with --marketplace: $hit"
done < <(grep -rnE --exclude-dir=node_modules "$pc.*--marketplace" README.md CHANGELOG.md skills || true)

[ "$fail" = 0 ] && echo "check-warden-texts: all commands match"
exit "$fail"
