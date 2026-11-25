# Changelog

All notable changes to this package are listed here.

## 0.1.0 (2026-11-25)

- First version of the stdio bridge to Warden agent access.
- The package is also the Claude Code plugin `warden-mcp`:
  `.claude-plugin/plugin.json` (which declares the MCP server) and the `warden`
  skill sit at the package root. The repository root is the `purgecc`
  marketplace: it follows the default branch, which moves only at a release,
  and names this exact npm version.
- A connect that times out gives its own message for the TCP connect and for
  the TLS handshake.
