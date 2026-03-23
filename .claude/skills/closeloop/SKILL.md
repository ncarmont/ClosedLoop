---
name: closeloop
description: This skill should be used when the user asks to "control the browser", "use CloseLoop", "take a screenshot of the browser", "navigate to a page", "click on the page", "type into the browser", "check console errors", "test the UI in the browser", "use the real browser", "verify the UI", or any task that requires seeing or interacting with the live Chrome browser. This skill provides complete setup, operation, and workflow guidance for the CloseLoop browser automation bridge.
version: 0.1.0
tools: Bash, Read
---

# CloseLoop — Live Browser Control

CloseLoop is a local HTTP bridge between this agent and the user's real Chrome browser. It consists of three parts working together:

| Part | Location | Role |
|------|----------|------|
| **MCP server** | `mcp-server/server.js` | Express + WebSocket bridge on `localhost:9009` |
| **Chrome extension** | `extension/` | Connects to the server, executes commands in the real browser |
| **Demo** | `demo/calculator/` | Broken calculator — use it to practice and verify everything works |

All browser interaction happens through `curl` calls to `localhost:9009`. No Playwright, no headless browser — this is the user's actual Chrome with all their sessions, cookies, and state.

## Current Connection Status

- Server: !`curl -s http://localhost:9009/status 2>/dev/null || echo "Server not running"`

---

## Setup (first time only)

```bash
# Step 1 — install server dependencies and print instructions
bash setup.sh

# Step 2 — start the bridge server (keep running in a separate terminal)
node mcp-server/server.js

# Step 3 — load the Chrome extension
# Open Chrome → chrome://extensions → enable Developer mode → Load unpacked → select ./extension/
# The extension popup badge turns green when connected.
```

Verify the connection before issuing commands:
```bash
curl -s http://localhost:9009/status
# Expected: {"extensionConnected": true, "lastAgentCall": null}
```

## Try the demo

Open the broken calculator in Chrome to verify the setup works end-to-end:
```bash
# Get the absolute path
echo "file://$(pwd)/demo/calculator/index.html"
# Then navigate to it:
curl -s -X POST http://localhost:9009/navigate \
  -H "Content-Type: application/json" \
  -d "{\"url\": \"file://$(pwd)/demo/calculator/index.html\"}"
```
The demo calculator has intentional bugs — use CloseLoop to find and fix them.

---

## Bringing Chrome to the front — REQUIRED

**Before taking any action in the browser, bring the Chrome window to the front so the user can see you working in real time.** This is not optional. The user needs to watch.

Run the appropriate command for the platform:

```bash
# macOS (always try this first)
osascript -e 'tell application "Google Chrome" to activate'

# Linux (fallback)
wmctrl -a "Google Chrome" 2>/dev/null || xdotool search --name "Google Chrome" windowactivate 2>/dev/null || true
```

Run this command at the very start of every browser task and again after any long pause. The user should never have to hunt for the browser window — bring it to them.

---

## Standard opening sequence

Run these commands at the start of every browser task, in this exact order:

```bash
# 0. Bring Chrome to the front — user must be able to see what you're doing
osascript -e 'tell application "Google Chrome" to activate'

# 1. Attach the Chrome debugger (enables console + network error capture)
curl -s -X POST http://localhost:9009/attach-debugger

# 2. Take a screenshot to see the current state
curl -s -X POST http://localhost:9009/screenshot

# 3. View it — this is a real image
# Read /tmp/closedloop-screenshot.png

# 4. Get full page context: URL, title, body text, interactive elements + CSS selectors
curl -s http://localhost:9009/context
```

---

## Visual feedback (built-in)

While commands are executing:
- A **pulsing purple glow ring** appears around the border of the active browser tab
- A **banner reading "An AI agent is controlling this browser tab"** floats at the top of the page
- The **side panel opens automatically** with a live feed of every action taken and all screenshots
- The extension **popup shows the last screenshot** captured

The user can see everything happening in real time.

---

## Core commands

### Navigate
```bash
curl -s -X POST http://localhost:9009/navigate \
  -H "Content-Type: application/json" \
  -d '{"url": "http://localhost:3000/dashboard"}'
```
Waits for full page load (up to 12s). Always screenshot after to confirm what rendered.

### Screenshot
```bash
curl -s -X POST http://localhost:9009/screenshot
# Always view immediately after:
# Read /tmp/closedloop-screenshot.png
```

### Click
```bash
curl -s -X POST http://localhost:9009/click \
  -H "Content-Type: application/json" \
  -d '{"selector": "#submit-button"}'
```
Get selectors from `/context`. Prefer `#id`, `[data-testid="..."]`, `[aria-label="..."]`.

### Type
```bash
curl -s -X POST http://localhost:9009/type \
  -H "Content-Type: application/json" \
  -d '{"selector": "#email", "text": "test@example.com"}'
```
React-compatible. Clears the field first by default. Pass `"clear": false` to append.

### Page context
```bash
curl -s http://localhost:9009/context
```
Returns URL, title, body text (3000 chars), and up to 40 interactive elements with CSS selectors.

### Debug errors
```bash
curl -s http://localhost:9009/console-errors
curl -s http://localhost:9009/network-errors
```
Returns errors captured since the last `attach-debugger` call, then clears the buffer.

### Request user approval (for risky or uncertain actions)

Before taking any action that is destructive, irreversible, or uncertain, ask the user first:

```bash
curl -s -X POST http://localhost:9009/request-approval \
  -H "Content-Type: application/json" \
  -d '{
    "action": "Submit the payment form with card ending 4242",
    "reason": "This will charge the card. Please confirm before proceeding."
  }'
# Returns: {"approved": true} or {"approved": false}
```

**You MUST check the response.** If `approved` is `false`, abort the action entirely — do not proceed.

A centered bubble appears on the page saying "Please approve in the side panel 👉" and the side panel shows an Approve / Deny card. The call blocks until the user responds (or 60s timeout, which counts as denied).

**When to use this — mandatory for:**
- Submitting forms that send data, make payments, or create/delete records
- Destructive actions: deleting files, clearing databases, removing users
- Actions where you are unsure what will happen
- Any action outside the scope the user explicitly asked for

**When NOT to use:** reading pages, taking screenshots, navigating, getting context.

### Mobile emulation (responsive design mode)
```bash
# Enable — emulates iPhone 15 Pro (393×852, DPR 3, mobile user-agent)
curl -s -X POST http://localhost:9009/toggle-mobile \
  -H "Content-Type: application/json" \
  -d '{"enable": true}'

# Disable — restore full desktop viewport
curl -s -X POST http://localhost:9009/toggle-mobile \
  -H "Content-Type: application/json" \
  -d '{"enable": false}'

# Toggle (no body needed)
curl -s -X POST http://localhost:9009/toggle-mobile
```
Requires the debugger to be attached (auto-attaches if not). After enabling, take a screenshot to confirm the mobile viewport, then continue clicking/typing as normal — element highlights work in the responsive view.

---

## Workflow — UI verification

```bash
osascript -e 'tell application "Google Chrome" to activate'
curl -s -X POST http://localhost:9009/navigate \
  -H "Content-Type: application/json" \
  -d '{"url": "http://localhost:3000/the-page"}'
curl -s -X POST http://localhost:9009/screenshot
# Read /tmp/closedloop-screenshot.png
```

## Workflow — Form fill + submit

```bash
osascript -e 'tell application "Google Chrome" to activate'
curl -s http://localhost:9009/context   # discover selectors
curl -s -X POST http://localhost:9009/type -H "Content-Type: application/json" -d '{"selector": "#email", "text": "test@example.com"}'
curl -s -X POST http://localhost:9009/type -H "Content-Type: application/json" -d '{"selector": "#password", "text": "secret123"}'
curl -s -X POST http://localhost:9009/click -H "Content-Type: application/json" -d '{"selector": "[type=\"submit\"]"}'
curl -s -X POST http://localhost:9009/screenshot
# Read /tmp/closedloop-screenshot.png
```

## Workflow — Debug broken page

```bash
osascript -e 'tell application "Google Chrome" to activate'
curl -s -X POST http://localhost:9009/attach-debugger
curl -s -X POST http://localhost:9009/navigate -H "Content-Type: application/json" -d '{"url": "http://localhost:3000/broken-page"}'
curl -s http://localhost:9009/console-errors
curl -s http://localhost:9009/network-errors
curl -s -X POST http://localhost:9009/screenshot
# Read /tmp/closedloop-screenshot.png
```

## Workflow — Optimise for mobile / test responsive layout

```bash
osascript -e 'tell application "Google Chrome" to activate'
curl -s -X POST http://localhost:9009/attach-debugger
curl -s -X POST http://localhost:9009/toggle-mobile -H "Content-Type: application/json" -d '{"enable": true}'
curl -s -X POST http://localhost:9009/screenshot
# Read /tmp/closedloop-screenshot.png
# Now interact as normal — click, type, context all work in mobile viewport
curl -s http://localhost:9009/context
# When done, restore desktop:
curl -s -X POST http://localhost:9009/toggle-mobile -H "Content-Type: application/json" -d '{"enable": false}'
```

---

## Quick rules

- **Bring Chrome to front first, always** — run `osascript -e 'tell application "Google Chrome" to activate'` before the first action and after any long pause. Never let the user miss what's happening.
- **Screenshot after every navigation** — confirm what actually rendered
- **Get context before clicking** — it returns real DOM selectors, don't guess
- **Commands time out after 15s** — if a page is slow, navigate then wait
- **One active tab** — CloseLoop always operates on the currently focused Chrome tab
- **Server port is 9009** — if not running, start with `node mcp-server/server.js`

## Additional resources

- **`references/api-reference.md`** — complete endpoint reference with all parameters
- **`references/workflow-patterns.md`** — recipes for common multi-step scenarios
