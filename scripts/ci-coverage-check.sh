#!/bin/bash
set -e

THRESHOLD=${COVERAGE_THRESHOLD:-80}
COVERAGE_FILE="coverage/coverage-summary.json"

if [ ! -f "$COVERAGE_FILE" ]; then
  echo "Coverage file not found. Skipping coverage check."
  exit 0
fi

LINE_COVERAGE=$(node -e "const c = require('./$COVERAGE_FILE'); console.log(c.total.lines.pct)")
BRANCH_COVERAGE=$(node -e "const c = require('./$COVERAGE_FILE'); console.log(c.total.branches.pct)")
STMT_COVERAGE=$(node -e "const c = require('./$COVERAGE_FILE'); console.log(c.total.statements.pct)")
FUNC_COVERAGE=$(node -e "const c = require('./$COVERAGE_FILE'); console.log(c.total.functions.pct)")

# Write to GitHub step summary if available
if [ -n "$GITHUB_STEP_SUMMARY" ]; then
  echo "### Coverage Report" >> "$GITHUB_STEP_SUMMARY"
  echo "| Metric | Coverage | Threshold |" >> "$GITHUB_STEP_SUMMARY"
  echo "|--------|----------|-----------|" >> "$GITHUB_STEP_SUMMARY"
  echo "| Lines | ${LINE_COVERAGE}% | ${THRESHOLD}% |" >> "$GITHUB_STEP_SUMMARY"
  echo "| Branches | ${BRANCH_COVERAGE}% | - |" >> "$GITHUB_STEP_SUMMARY"
  echo "| Statements | ${STMT_COVERAGE}% | - |" >> "$GITHUB_STEP_SUMMARY"
  echo "| Functions | ${FUNC_COVERAGE}% | - |" >> "$GITHUB_STEP_SUMMARY"
fi

# Validate coverage value is numeric before comparison
if ! node -e "const v = Number('$LINE_COVERAGE'); if (isNaN(v)) { process.exit(1); }"; then
  echo "Error: Line coverage value '$LINE_COVERAGE' is not a valid number"
  exit 1
fi

# Check threshold using node for cross-platform float comparison
BELOW_THRESHOLD=$(node -e "console.log(Number('$LINE_COVERAGE') < Number('$THRESHOLD') ? 'true' : 'false')")

if [ "$BELOW_THRESHOLD" = "true" ]; then
  echo "Line coverage ${LINE_COVERAGE}% is below threshold ${THRESHOLD}%"
  exit 1
fi

echo "Coverage check passed: ${LINE_COVERAGE}% >= ${THRESHOLD}%"
