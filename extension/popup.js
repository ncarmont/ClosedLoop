const SERVER = 'http://localhost:9009';
const AGENT_ACTIVE_WINDOW_MS = 10_000; // show "AI agent active" for 10s after last call

const INSTRUCTIONS = `You have access to ClosedLoop — a live HTTP bridge to my real Chrome browser.
The server is running at http://localhost:9009.

Use these curl commands (via the Bash tool) to interact with my browser:

# 1. Attach the Chrome debugger first (enables error capture)
curl -s -X POST http://localhost:9009/attach-debugger

# 2. Take a screenshot (saved to /tmp/closedloop-screenshot.png)
curl -s -X POST http://localhost:9009/screenshot
# Then use the Read tool to view it: Read /tmp/closedloop-screenshot.png

# 3. Get page context (URL, title, body text, all interactive elements + CSS selectors)
curl -s http://localhost:9009/context

# 4. Click an element by CSS selector
curl -s -X POST http://localhost:9009/click \\
  -H "Content-Type: application/json" \\
  -d '{"selector": "#my-button"}'

# 5. Type text into an input
curl -s -X POST http://localhost:9009/type \\
  -H "Content-Type: application/json" \\
  -d '{"selector": "#email-input", "text": "hello@example.com"}'

# 6. Navigate to a URL
curl -s -X POST http://localhost:9009/navigate \\
  -H "Content-Type: application/json" \\
  -d '{"url": "http://localhost:3000/dashboard"}'

# 7. Get console errors captured since attach-debugger
curl -s http://localhost:9009/console-errors

# 8. Get network errors (4xx/5xx, failed requests)
curl -s http://localhost:9009/network-errors

Start now: run attach-debugger, then screenshot (and Read the file), then get context.
You do not need to ask me to click anything — use the tools above to do it yourself.`;

// ── UI helpers ────────────────────────────────────────────────────────────────

function setServer(connected, sub) {
  const dot = document.getElementById('server-dot');
  const label = document.getElementById('server-label');
  const subEl = document.getElementById('server-sub');
  const card = document.getElementById('server-card');
  const startBox = document.getElementById('start-box');

  dot.className = 'dot ' + (connected ? 'on' : 'off');
  label.textContent = connected ? 'Server running' : 'Server not running';
  subEl.textContent = sub || 'http://localhost:9009';
  card.className = 'status-card' + (connected ? ' active' : '');
  startBox.style.display = connected ? 'none' : 'block';
}

function setAgent(active, lastCall) {
  const dot = document.getElementById('agent-dot');
  const label = document.getElementById('agent-label');
  const sub = document.getElementById('agent-sub');
  const card = document.getElementById('agent-card');

  if (active) {
    dot.className = 'dot agent pulse';
    label.textContent = 'AI agent active';
    sub.textContent = lastCall ? 'Last call: ' + lastCall.endpoint : '';
    card.className = 'status-card agent-active';
  } else if (lastCall) {
    dot.className = 'dot agent';
    label.textContent = 'AI agent connected';
    const ago = Math.round((Date.now() - lastCall.at) / 1000);
    sub.textContent = `Last seen ${ago}s ago — ${lastCall.endpoint}`;
    card.className = 'status-card';
  } else {
    dot.className = 'dot off';
    label.textContent = 'No AI agent connected';
    sub.textContent = 'Waiting for API calls...';
    card.className = 'status-card';
  }
}

// ── Poll the server every 2s ──────────────────────────────────────────────────

async function poll() {
  try {
    const res = await fetch(`${SERVER}/status`, { signal: AbortSignal.timeout(2000) });
    const data = await res.json();
    const extConnected = data.extensionConnected;

    setServer(true, extConnected ? 'Extension connected' : 'Extension not connected');

    if (!extConnected) {
      setAgent(false, null);
      return;
    }

    const lastCall = data.lastAgentCall;
    const agentActive = lastCall && (Date.now() - lastCall.at) < AGENT_ACTIVE_WINDOW_MS;
    setAgent(agentActive, lastCall);

  } catch {
    setServer(false);
    setAgent(false, null);
  }
}

// ── Active tab ────────────────────────────────────────────────────────────────

async function updateTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) {
    document.getElementById('tab-title').textContent = tab.title?.slice(0, 50) || '—';
    document.getElementById('tab-url').textContent = tab.url?.slice(0, 65) || '—';
  }
}

// ── Server start command path ─────────────────────────────────────────────────

// We don't know the install path at runtime, so show a placeholder the user can
// personalise. The setup.sh script prints the exact command with the real path.
document.getElementById('start-cmd').textContent =
  'node /path/to/closedloop/mcp-server/server.js';

// ── Copy button ───────────────────────────────────────────────────────────────

document.getElementById('copy-btn').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(INSTRUCTIONS);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = INSTRUCTIONS;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  }
  const label = document.getElementById('copy-label');
  const btn = document.getElementById('copy-btn');
  label.textContent = 'Copied!';
  btn.classList.add('copied');
  setTimeout(() => {
    label.textContent = 'Copy instructions for your AI';
    btn.classList.remove('copied');
  }, 2000);
});

// ── Screenshot preview ────────────────────────────────────────────────────────

async function updateScreenshot() {
  const data = await chrome.storage.local.get(['lastScreenshot', 'lastScreenshotTime']);
  const section = document.getElementById('screenshot-section');
  const img = document.getElementById('screenshot-preview');
  const timeEl = document.getElementById('screenshot-time');

  if (data.lastScreenshot) {
    img.src = data.lastScreenshot;
    section.style.display = 'block';
    if (data.lastScreenshotTime) {
      const ago = Math.round((Date.now() - data.lastScreenshotTime) / 1000);
      timeEl.textContent = ago < 60 ? `${ago}s ago` : `${Math.round(ago / 60)}m ago`;
    }
  }
}

// ── Init ──────────────────────────────────────────────────────────────────────

poll();
updateTab();
updateScreenshot();
setInterval(poll, 2000);
setInterval(updateScreenshot, 2000);
