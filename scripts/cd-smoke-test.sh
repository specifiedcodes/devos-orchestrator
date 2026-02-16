#!/bin/bash
set -e

# Configuration
DEPLOY_URL="${DEPLOY_URL:-http://localhost:3003}"
MAX_RETRIES=${MAX_RETRIES:-30}
RETRY_DELAY=${RETRY_DELAY:-10}
MAX_RESPONSE_TIME=${MAX_RESPONSE_TIME:-10}

echo "Running orchestrator smoke tests against: $DEPLOY_URL"

# Test 1: Basic deployment verification
# Orchestrator is internal and may not expose a public health endpoint.
# Verify the service is reachable or check deployment status.
echo "Test 1: Deployment status verification..."
ATTEMPT=0
DEPLOYED=false
while [ $ATTEMPT -lt $MAX_RETRIES ]; do
  HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time $MAX_RESPONSE_TIME "$DEPLOY_URL/health" 2>/dev/null || echo "000")
  if [ "$HTTP_STATUS" = "200" ]; then
    DEPLOYED=true
    break
  fi
  echo "  Attempt $((ATTEMPT + 1))/$MAX_RETRIES: status=$HTTP_STATUS, retrying in ${RETRY_DELAY}s..."
  ATTEMPT=$((ATTEMPT + 1))
  sleep $RETRY_DELAY
done

if [ "$DEPLOYED" = "true" ]; then
  echo "PASS: Orchestrator health endpoint returned 200"
else
  echo "FAIL: Orchestrator health endpoint not reachable after $MAX_RETRIES retries"
  echo "The internal service did not respond within the expected time window."
  exit 1
fi

# Summary
echo ""
echo "All orchestrator smoke tests passed!"

# Write to GitHub step summary if available
if [ -n "$GITHUB_STEP_SUMMARY" ]; then
  echo "### Orchestrator Smoke Test Results" >> "$GITHUB_STEP_SUMMARY"
  echo "| Test | Status |" >> "$GITHUB_STEP_SUMMARY"
  echo "|------|--------|" >> "$GITHUB_STEP_SUMMARY"
  echo "| Deployment verification | PASS |" >> "$GITHUB_STEP_SUMMARY"
  echo "| Deploy URL | $DEPLOY_URL |" >> "$GITHUB_STEP_SUMMARY"
fi
