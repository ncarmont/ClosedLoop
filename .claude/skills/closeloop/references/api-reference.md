# CloseLoop API Reference

All endpoints are on `http://localhost:9009`. All POST bodies are JSON.
Commands time out after 15 seconds. The active tab is whichever Chrome tab is currently focused.

---

## GET /status

Check server health and extension connection state.

```bash
curl -s http://localhost:9009/status
```

**Response:**
```json
{
  "extensionConnected": true,
  "lastAgentCall": {
    "endpoint": "POST /screenshot",
    "at": 1234567890000
  }
}
```

`extensionConnected: false` means either the server is not running or the Chrome extension is not loaded. Check `chrome://extensions` and reload the extension.

---

## GET /context

Returns the current page's URL, title, visible body text, and up to 40 interactive elements with their best CSS selectors.

```bash
curl -s http://localhost:9009/context
```

**Response:**
```json
{
  "url": "https://example.com/login",
  "title": "Login — Example",
  "bodyText": "Welcome back. Sign in to continue...",
  "interactable": [
    {
      "tag": "input",
      "text": "",
      "selector": "#email",
      "type": "email",
      "href": null,
      "disabled": false,
      "placeholder": "you@example.com"
    },
    {
      "tag": "button",
      "text": "Sign in",
      "selector": "[aria-label=\"Sign in\"]",
      "type": "submit",
      "href": null,
      "disabled": false,
      "placeholder": null
    }
  ]
}
```

**Selector priority** (best to worst): `#id` → `[data-testid="..."]` → `[name="..."]` → `[aria-label="..."]`. Elements without a usable selector are omitted.

---

## POST /screenshot

Captures a full PNG of the visible tab. Saves to `/tmp/closedloop-screenshot.png`. Returns the saved path, current URL, and page title.

```bash
curl -s -X POST http://localhost:9009/screenshot
```

**Response:**
```json
{
  "saved": "/tmp/closedloop-screenshot.png",
  "url": "https://example.com/dashboard",
  "title": "Dashboard — Example"
}
```

**View the image:**
```
Read /tmp/closedloop-screenshot.png
```

Always call `Read` on the file immediately after — it is a real image and provides visual confirmation of the page state.

---

## POST /navigate

Navigates the active tab to the given URL. Waits for the page to reach `complete` load status (up to 12 seconds).

```bash
curl -s -X POST http://localhost:9009/navigate \
  -H "Content-Type: application/json" \
  -d '{"url": "http://localhost:3000/settings"}'
```

**Body:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `url` | string | yes | Full URL including protocol |

**Response:**
```json
{
  "navigated": "http://localhost:3000/settings",
  "title": "Settings — MyApp"
}
```

Always screenshot after navigating to confirm the rendered state. For SPAs that render after JS executes, the page may look different after a short delay.

---

## POST /click

Clicks an element identified by CSS selector. Scrolls the element into view before clicking.

```bash
curl -s -X POST http://localhost:9009/click \
  -H "Content-Type: application/json" \
  -d '{"selector": "#submit-btn"}'
```

**Body:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `selector` | string | yes | Valid CSS selector |

**Response (success):**
```json
{
  "clicked": "#submit-btn",
  "tag": "button",
  "text": "Submit"
}
```

**Response (failure):**
```json
{ "error": "No element found for: #submit-btn" }
```

**Selector tips:**
- Use `/context` to discover real selectors — never guess
- `#id` is most reliable
- `[data-testid="login-btn"]` is common in React apps
- `[aria-label="Close"]` works for icon buttons without text
- Complex selectors like `.nav > ul > li:first-child > a` are fragile — avoid

---

## POST /type

Types text into an input or textarea. Fires `input` and `change` events (React-compatible). Clears the field first by default.

```bash
curl -s -X POST http://localhost:9009/type \
  -H "Content-Type: application/json" \
  -d '{"selector": "#search", "text": "hello world"}'
```

**Body:**
| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `selector` | string | yes | — | CSS selector for the input |
| `text` | string | yes | — | Text to type |
| `clear` | boolean | no | `true` | Clear field before typing |

**Append to existing value:**
```bash
curl -s -X POST http://localhost:9009/type \
  -H "Content-Type: application/json" \
  -d '{"selector": "#notes", "text": " (updated)", "clear": false}'
```

**Response (success):**
```json
{
  "typed": "hello world",
  "into": "#search",
  "cleared": true
}
```

---

## POST /attach-debugger

Attaches the Chrome DevTools Protocol debugger to the active tab. Enables `Runtime` and `Network` domains for error capture. Clears the console and network error buffers. Must be called before `/console-errors` or `/network-errors` will collect data.

```bash
curl -s -X POST http://localhost:9009/attach-debugger
```

**Response:**
```json
{
  "attached": true,
  "tabId": 42,
  "url": "http://localhost:3000/"
}
```

If navigating to a new tab after attaching, call `attach-debugger` again since it attaches per-tab.

---

## GET /console-errors

Returns all console errors, warnings, and uncaught exceptions captured since the last `attach-debugger` call. Clears the buffer after returning.

```bash
curl -s http://localhost:9009/console-errors
```

**Response:**
```json
{
  "errors": [
    {
      "type": "error",
      "message": "TypeError: Cannot read property 'map' of undefined",
      "timestamp": 1234567890000
    },
    {
      "type": "exception",
      "message": "Uncaught ReferenceError: foo is not defined",
      "url": "http://localhost:3000/main.js",
      "line": 42,
      "timestamp": 1234567891000
    }
  ]
}
```

**Error types:** `error`, `warning`, `exception`

---

## GET /network-errors

Returns all failed HTTP requests (connection errors, 4xx, 5xx) captured since the last `attach-debugger` call. Clears the buffer after returning.

```bash
curl -s http://localhost:9009/network-errors
```

**Response:**
```json
{
  "errors": [
    {
      "type": "http_error",
      "url": "http://localhost:3000/api/users",
      "status": 500,
      "timestamp": 1234567890000
    },
    {
      "type": "load_failed",
      "requestId": "1234.5",
      "error": "net::ERR_CONNECTION_REFUSED",
      "timestamp": 1234567891000
    }
  ]
}
```

**Error types:** `http_error` (status ≥ 400), `load_failed` (network-level failure)
