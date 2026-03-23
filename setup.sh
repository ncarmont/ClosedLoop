#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SERVER_PATH="$SCRIPT_DIR/mcp-server/server.js"

echo ""
echo "CloseLoop setup"
echo "==============="
echo ""

# 1. Install deps
echo "Installing MCP server dependencies..."
cd "$SCRIPT_DIR/mcp-server" && npm install --silent
echo "Done."
echo ""

# 2. Print Claude Code MCP config
echo "Add this to your Claude Code MCP config:"
echo "  claude mcp add closeloop node -- \"$SERVER_PATH\""
echo ""
echo "Or manually add to ~/.claude/settings.json under mcpServers:"
echo ""
cat <<JSON
  "closeloop": {
    "command": "node",
    "args": ["$SERVER_PATH"]
  }
JSON

echo ""
echo "3. Load the Chrome extension:"
echo "   - Open Chrome → chrome://extensions"
echo "   - Enable Developer mode (top right)"
echo "   - Click 'Load unpacked'"
echo "   - Select: $SCRIPT_DIR/extension"
echo ""
echo "4. Start using it in Claude Code:"
echo "   - The extension popup shows 'Connected' when the MCP server is running"
echo "   - Ask Claude Code to use the closeloop tools to inspect/control your browser"
echo ""
echo "Available tools: get_page_context, take_screenshot, click_element,"
echo "                 type_text, navigate_to, attach_debugger,"
echo "                 get_console_errors, get_network_errors"
echo ""
