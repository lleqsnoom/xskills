#!/usr/bin/env bash
# Fails closed before the scheduled reflection: a dirty skills tree, a missing collector, or a window
# with no x-skill session means there is nothing to review, and Orca records a skipped run instead of
# paying an agent for one. Exit 0 continues the run; anything else records a skip.
set -uo pipefail

ROOT="${XSKILLS_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
COLLECT="$ROOT/automation/daily-reflection/collect-sessions.mjs"

fail() {
  echo "precheck: $1 — skipping this run"
  exit 1
}

command -v crush >/dev/null 2>&1 || fail "crush is not on PATH"
command -v node >/dev/null 2>&1 || fail "node is not on PATH"
[ -f "$COLLECT" ] || fail "collector missing at $COLLECT"
[ -d "$ROOT/skills" ] || fail "skills/ missing at $ROOT"

# Every proposal cites skills/<name>/SKILL.md:<line>. Uncommitted skill edits move those lines, so the
# citations a reflection writes would point at text the repository no longer has.
if [ -d "$ROOT/.git" ]; then
  dirty=$(git -C "$ROOT" status --porcelain -- skills 2>/dev/null)
  [ -z "$dirty" ] || fail "skills/ has uncommitted changes, so line citations would be unstable"
fi

# The probe scans the window exactly as the run will, so a skip here is a real "nothing happened".
# Exit 1 is an empty window; anything else is the collector failing, and that must not be recorded as
# a quiet day. Both skip the run, but only the first is routine.
probe=$(node "$COLLECT" --check 2>&1)
status=$?
case $status in
  0) echo "precheck: ok"; exit 0 ;;
  1) fail "no session in the window used an x-skill" ;;
  *) echo "precheck: collector failed (exit $status): $probe — skipping this run"; exit 1 ;;
esac
