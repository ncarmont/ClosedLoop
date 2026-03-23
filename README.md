# CloseLoop

**Give your coding agent your real browser.**

Stop babysitting your AI agent. CloseLoop closes the loop — your agent can see your actual browser, click around, take screenshots, and catch errors on its own. You grab a coffee; it gets the work done.

---

## Before vs After

| Before CloseLoop | After CloseLoop |
|---|---|
| Agent codes a feature, you manually open the browser to check it | Agent opens the browser, verifies the result, fixes issues automatically |
| "It works on my machine" — agent can't see what you see | Agent takes a screenshot of your real signed-in session |
| You copy-paste console errors back to the agent | Agent captures console/network errors directly from the debugger |
| Agent writes code blindly, you babysit every step | Agent sees → acts → verifies → ships |

---

## How It Works

CloseLoop is two pieces that work together:

1. **Chrome Extension** — a Manifest V3 extension that runs in your browser and exposes your active tab over a local WebSocket
2. **MCP Server** — a Node.js server that bridges the extension to Claude Code (or any MCP client) over stdio

```
Claude Code  ←→  MCP Server (stdio)  ←→  WebSocket (localhost:9009)  ←→  Chrome Extension  ←→  Your Browser
```

---

## Tools Available to Claude

| Tool | What it does |
|---|---|
| `screenshot` | Captures a screenshot of the active tab |
| `get_dom` | Returns the full DOM/HTML of the page |
| `click` | Clicks an element by CSS selector |
| `type` | Types text into a focused input |
| `navigate` | Navigates to a URL |
| `get_url` | Returns the current tab URL |
| `get_console_errors` | Retrieves JS console errors via the debugger |
| `get_network_errors` | Retrieves failed network requests via the debugger |

---

## Quick Start

### 1. Install the MCP Server

```bash
git clone https://github.com/nickcarmont/closeloop.git
cd closeloop
bash setup.sh
```

### 2. Load the Chrome Extension

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** → select the `extension/` folder
4. Click the CloseLoop icon — it should show **Connected**

### 3. Add to Claude Code

Add this to your MCP config (`~/.claude/mcp_settings.json`):

```json
{
  "mcpServers": {
    "closeloop": {
      "command": "node",
      "args": ["/path/to/closeloop/mcp-server/server.js"]
    }
  }
}
```

Restart Claude Code. CloseLoop tools will appear automatically.

---

## Requirements

- Node.js 18+
- Google Chrome
- Claude Code (or any MCP-compatible agent)

---

## License

MIT
