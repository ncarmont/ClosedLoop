import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const PORT = 9009;

// ── HTTP server ───────────────────────────────────────────────────────────────

const app = express();
app.use(express.json());

// Allow requests from the Chrome extension popup (chrome-extension://* origin)
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

const httpServer = createServer(app);

// ── WebSocket bridge (Chrome extension connects here) ─────────────────────────

const wss = new WebSocketServer({ server: httpServer });
let extensionSocket = null;
const pending = new Map();
let nextId = 1;
let lastAgentCall = null; // track when the AI agent last used the API

wss.on('connection', (ws) => {
  extensionSocket = ws;
  process.stdout.write('[ClosedLoop] Chrome extension connected\n');

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data);
      const resolve = pending.get(msg.id);
      if (resolve) {
        pending.delete(msg.id);
        resolve(msg.result);
      }
    } catch {}
  });

  ws.on('close', () => {
    extensionSocket = null;
    process.stdout.write('[ClosedLoop] Chrome extension disconnected\n');
  });
});

async function sendToExtension(command, params = {}) {
  if (!extensionSocket || extensionSocket.readyState !== 1) {
    throw new Error(
      'Chrome extension not connected. ' +
      'Make sure ClosedLoop is installed and the popup shows a green dot.'
    );
  }
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Command "${command}" timed out after 15s`));
    }, 15_000);
    pending.set(id, (result) => {
      clearTimeout(timer);
      resolve(result);
    });
    extensionSocket.send(JSON.stringify({ id, command, params }));
  });
}

function trackAgentCall(req, res, next) {
  lastAgentCall = { endpoint: req.method + ' ' + req.path, at: Date.now() };
  next();
}

// ── Routes ────────────────────────────────────────────────────────────────────

// Status — polled by the extension popup to show connection + agent activity
app.get('/status', (req, res) => {
  res.json({
    extensionConnected: !!extensionSocket && extensionSocket.readyState === 1,
    lastAgentCall,
  });
});

// Get page context (URL, title, body text, interactive elements + selectors)
app.get('/context', trackAgentCall, async (req, res) => {
  try {
    res.json(await sendToExtension('get_page_context'));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Screenshot — saves PNG to /tmp/closedloop-screenshot.png, returns the path
// Use the Read tool to view the image after calling this.
app.post('/screenshot', trackAgentCall, async (req, res) => {
  try {
    const result = await sendToExtension('take_screenshot');
    const base64 = result.screenshot.replace(/^data:image\/\w+;base64,/, '');
    const path = join(tmpdir(), 'closedloop-screenshot.png');
    writeFileSync(path, Buffer.from(base64, 'base64'));
    res.json({ saved: path, url: result.url, title: result.title });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Click an element by CSS selector
// Body: { "selector": "#my-button" }
app.post('/click', trackAgentCall, async (req, res) => {
  try {
    res.json(await sendToExtension('click_element', req.body));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Type text into an input
// Body: { "selector": "#email", "text": "hello@example.com", "clear": true }
app.post('/type', trackAgentCall, async (req, res) => {
  try {
    res.json(await sendToExtension('type_text', req.body));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Navigate the current tab to a URL
// Body: { "url": "http://localhost:3000/dashboard" }
app.post('/navigate', trackAgentCall, async (req, res) => {
  try {
    res.json(await sendToExtension('navigate_to', req.body));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Attach Chrome debugger — call before getting console/network errors
app.post('/attach-debugger', trackAgentCall, async (req, res) => {
  try {
    res.json(await sendToExtension('attach_debugger'));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Get console errors captured since attach-debugger was last called
app.get('/console-errors', trackAgentCall, async (req, res) => {
  try {
    res.json(await sendToExtension('get_console_errors'));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Get network errors (4xx/5xx, failed requests) since attach-debugger
app.get('/network-errors', trackAgentCall, async (req, res) => {
  try {
    res.json(await sendToExtension('get_network_errors'));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Request user approval before proceeding with a risky or uncertain action
// Body: { "action": "Delete all records in the users table", "reason": "This is irreversible" }
// Returns: { "approved": true } or { "approved": false }
// The agent MUST check the response — if approved is false, abort the action entirely.
app.post('/request-approval', trackAgentCall, async (req, res) => {
  try {
    res.json(await sendToExtension('request_approval', req.body));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Toggle mobile emulation (Chrome DevTools responsive design mode)
// Body: { "enable": true }  — omit to toggle, pass false to restore desktop
// Emulates iPhone 15 Pro (393×852, DPR 3) with mobile user-agent
app.post('/toggle-mobile', trackAgentCall, async (req, res) => {
  try {
    res.json(await sendToExtension('toggle_mobile', req.body));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Reload the Chrome extension — picks up background.js changes without touching the page DOM
app.post('/reload-extension', async (req, res) => {
  try {
    sendToExtension('reload_extension').catch(() => {}); // fire-and-forget — WS closes on reload
    res.json({ reloading: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Execute arbitrary JavaScript in the active tab
// Body: { "script": "document.title" }
// Returns: { "result": "..." } or { "error": "..." }
app.post('/execute-js', trackAgentCall, async (req, res) => {
  try {
    res.json(await sendToExtension('execute_js', req.body));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Set files on a file input element using Chrome DevTools Protocol
// Body: { "selector": "input[type='file']", "paths": ["/tmp/file.png"] }
app.post('/upload-file', trackAgentCall, async (req, res) => {
  try {
    res.json(await sendToExtension('upload_file', req.body));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Get all buttons on the current page (bypasses the 100-element context limit)
app.get('/buttons', trackAgentCall, async (req, res) => {
  try {
    res.json(await sendToExtension('get_all_buttons'));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Click a button by its visible text (case-insensitive, partial match fallback)
// Body: { "text": "Save" }
app.post('/click-button', trackAgentCall, async (req, res) => {
  try {
    res.json(await sendToExtension('click_button_by_text', req.body));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/reset-history', async (req, res) => {
  try {
    res.json(await sendToExtension('clear_history'));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────

httpServer.listen(PORT, 'localhost', () => {
  process.stdout.write(`\n[ClosedLoop] Server running at http://localhost:${PORT}\n`);
  process.stdout.write('[ClosedLoop] Waiting for Chrome extension to connect...\n\n');
  process.stdout.write('AI agent endpoints:\n');
  process.stdout.write(`  GET  http://localhost:${PORT}/context\n`);
  process.stdout.write(`  POST http://localhost:${PORT}/screenshot   (saves to /tmp/closedloop-screenshot.png)\n`);
  process.stdout.write(`  POST http://localhost:${PORT}/click        body: {"selector":"..."}\n`);
  process.stdout.write(`  POST http://localhost:${PORT}/type         body: {"selector":"...","text":"..."}\n`);
  process.stdout.write(`  POST http://localhost:${PORT}/navigate     body: {"url":"..."}\n`);
  process.stdout.write(`  POST http://localhost:${PORT}/attach-debugger\n`);
  process.stdout.write(`  GET  http://localhost:${PORT}/console-errors\n`);
  process.stdout.write(`  GET  http://localhost:${PORT}/network-errors\n`);
  process.stdout.write(`  POST http://localhost:${PORT}/toggle-mobile    body: {"enable":true|false}\n\n`);
});
