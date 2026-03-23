# ClosedLoop

**Stop babysitting your AI agent. Go get a coffee.**

ClosedLoop gives your coding agent your real, signed-in browser — so it can see what you see, click what you'd click, take screenshots, and catch its own errors. The loop is finally closed.

---

## The Problem

Your agent writes code. Then it waits. For *you* to open the browser, check if it worked, copy-paste the error back, and tell it what went wrong. You're the loop. You're the bottleneck.

## The Fix

ClosedLoop connects Claude Code directly to your live Chrome tab. Now the agent:

- Takes a screenshot to verify its own work
- Reads the DOM to understand what rendered
- Clicks, types, and navigates like a real user
- Pulls console errors and failed network requests straight from the debugger

You don't have to watch. It watches itself.

---

## Before vs After

| Without ClosedLoop | With ClosedLoop |
|---|---|
| Agent ships code, you open the browser to check | Agent opens the browser and checks itself |
| You copy-paste console errors back to the agent | Agent reads errors directly from the debugger |
| Agent asks "did it work?" after every change | Agent takes a screenshot and knows |
| You babysit every step of the way | You go get a coffee |

---

## How It Works

Two pieces, one bridge:

1. **Chrome Extension** — Manifest V3 extension that exposes your active tab over a secure local WebSocket
2. **MCP Server** — Node.js server that connects to the extension and surfaces browser control as MCP tools for Claude Code

```
Claude Code
    ↕  stdio (MCP)
MCP Server (Node.js)
    ↕  WebSocket · localhost:9009
Chrome Extension
    ↕  Chrome APIs
Your Real Browser
```

---

## Tools Claude Gets

| Tool | What it does |
|---|---|
| `screenshot` | Takes a screenshot of the active tab |
| `get_dom` | Returns the full HTML of the current page |
| `click` | Clicks any element by CSS selector |
| `type` | Types text into a focused input |
| `navigate` | Navigates to any URL |
| `get_url` | Returns the current tab's URL |
| `get_console_errors` | Captures JS console errors via the Chrome debugger |
| `get_network_errors` | Captures failed network requests via the Chrome debugger |

---

## Quick Start

### 1. Clone and install

```bash
git clone https://github.com/ncarmont/ClosedLoop.git
cd ClosedLoop
bash setup.sh
```

### 2. Load the Chrome extension

1. Go to `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked** → select the `extension/` folder
4. Click the ClosedLoop icon in your toolbar — it should show **Connected**

### 3. Wire up Claude Code

Add to your MCP config (`~/.claude/mcp_settings.json`):

```json
{
  "mcpServers": {
    "closeloop": {
      "command": "node",
      "args": ["/path/to/ClosedLoop/mcp-server/server.js"]
    }
  }
}
```

Restart Claude Code. The browser tools appear automatically.

---

## Requirements

- Node.js 18+
- Google Chrome
- Claude Code (or any MCP-compatible agent)

---

## Security

The WebSocket server binds to `localhost` only — nothing is exposed to the network. Your browser session never leaves your machine.

---

## License

MIT
