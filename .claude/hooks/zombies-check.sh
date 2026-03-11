#!/bin/bash
# zombies-check.sh
# PostToolUse hook: checks that test files written by Claude cover all ZOMBIES categories.
# Runs after Write and Edit tool calls. Non-blocking — provides feedback via additionalContext.
#
# ZOMBIES heuristic (James Grenning):
#   Z - Zero      : empty/initial state
#   O - One       : single interaction
#   M - Many      : multiple items
#   B - Boundary  : edges where behavior changes
#   I - Interface : API defined from caller's perspective (structural — not pattern-checked)
#   E - Exception : errors, invalid inputs, failure paths
#   S - Simple    : minimum code per test (structural — not pattern-checked)

# Read the JSON payload from stdin
INPUT=$(cat)

# Extract the file path — present in both Write (tool_input.file_path) and Edit (tool_input.file_path)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

# Exit immediately if no file path was provided
if [ -z "$FILE_PATH" ]; then
  exit 0
fi

# Only check test files (*.test.ts)
if [[ "$FILE_PATH" != *.test.ts ]]; then
  exit 0
fi

# Exit if the file does not exist (e.g. a failed write)
if [ ! -f "$FILE_PATH" ]; then
  exit 0
fi

# --- ZOMBIES pattern matching ---
# Each category is detected by searching test description strings (it/describe text).
# Patterns are case-insensitive and match common English phrasings used in test names.

# Z — Zero: tests for empty/initial/null state
Z_PATTERN="zero|empty|initial|no items|nothing|no data|no records|null|undefined|0 |no-op"
# O — One: tests for a single interaction or item
O_PATTERN="\bone\b|\bsingle\b|\ba single\b|\bone item\b|\bfirst item\b|\bone record\b|\bonce\b"
# M — Many: tests for multiple items or iterations
M_PATTERN="\bmany\b|\bmultiple\b|\bseveral\b|\bmore than one\b|\btwo or more\b|\blist of\b|\barray of\b|\bthree\b|\bbatch\b|\bpages\b"
# B — Boundary: tests for edges, limits, and transition points
B_PATTERN="boundary|edge|limit|maximum|minimum|\bmax\b|\bmin\b|\bfull\b|overflow|off-by-one|exceeds|at capacity|last item|first item"
# E — Exception/Error: tests for error paths and invalid inputs
E_PATTERN="\berror\b|\bthrows\b|\bthrow\b|\binvalid\b|\bexception\b|\bfails\b|\brejects\b|\bfailure\b|\bnot found\b|\bmissing\b|\bunavailable\b|\boffline\b"

# Run grep against the file content for each category
# -i = case-insensitive, -q = quiet (exit code only), -E = extended regex
MISSING=()

grep -iqE "$Z_PATTERN" "$FILE_PATH" || MISSING+=("Z (Zero — add a test for the empty/initial state)")
grep -iqE "$O_PATTERN" "$FILE_PATH" || MISSING+=("O (One — add a test for a single interaction)")
grep -iqE "$M_PATTERN" "$FILE_PATH" || MISSING+=("M (Many — add a test for multiple items or iterations)")
grep -iqE "$B_PATTERN" "$FILE_PATH" || MISSING+=("B (Boundary — add a test for edge cases and limits)")
grep -iqE "$E_PATTERN" "$FILE_PATH" || MISSING+=("E (Exception — add a test for errors and invalid inputs)")

# If all categories are covered, exit silently
if [ ${#MISSING[@]} -eq 0 ]; then
  exit 0
fi

# Build the missing-categories list as a newline-separated string
MISSING_LIST=$(printf '  - %s\n' "${MISSING[@]}")

# Output additionalContext so Claude sees the feedback and can act on it
# Best practice: use additionalContext (not systemMessage) so Claude receives actionable guidance
jq -n \
  --arg missing "$MISSING_LIST" \
  --arg file "$FILE_PATH" \
  '{
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      additionalContext: ("ZOMBIES check for \($file):\nThe following categories appear to be missing tests:\n\($missing)\nConsider adding tests for each missing category before finishing.")
    }
  }'

exit 0