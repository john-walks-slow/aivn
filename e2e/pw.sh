#!/bin/bash
export PLAYWRIGHT_MCP_SANDBOX=0
unset PLAYWRIGHT_MCP_PROXY_SERVER
playwright-cli "$@" 2>&1 | grep -v UNDICI | grep -v 'trace-warnings'
