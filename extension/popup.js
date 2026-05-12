const SERVER = 'http://localhost:9009';
const AGENT_ACTIVE_WINDOW_MS = 10_000;

const INSTRUCTIONS = `ClosedLoop now requires a manual session start from the Chrome popup.
I will start the session myself before asking you to use these endpoints.
Sessions auto-stop after 10 minutes of inactivity or 30 minutes total.

The server is running at http://localhost:9009.

Use these curl commands (via the Bash tool) to interact with my browser:

# 1. Attach the Chrome debugger first (enables error capture)
curl -s -X POST http://localhost:9009/attach-debugger

# 2. Take a screenshot (saved to /tmp/closedloop-screenshot.png)
curl -s -X POST http://localhost:9009/screenshot

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

Start with attach-debugger, then screenshot, then context.`;

let sessionActionPending = false;

function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes <= 0) return `${seconds}s`;
  if (seconds === 0) return `${minutes}m`;
  return `${minutes}m ${seconds}s`;
}

function describeStopReason(reason) {
  switch (reason) {
    case 'manual-stop': return 'Stopped manually';
    case 'idle-timeout': return 'Stopped after 10m idle';
    case 'max-duration': return 'Stopped after 30m max runtime';
    case 'tab-changed': return 'Stopped because the active tab changed';
    case 'tab-created': return 'Stopped because a new tab opened';
    case 'debug-tab-closed': return 'Stopped because the controlled tab closed';
    case 'idle':
    case null:
    case undefined:
      return 'Browser control is disabled until you start a session.';
    default:
      return `Stopped: ${reason}`;
  }
}

async function sendBackgroundMessage(type) {
  const response = await chrome.runtime.sendMessage({ type });
  if (!response?.ok) {
    throw new Error(response?.error || `Failed to ${type}`);
  }
  return response.session;
}

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
    sub.textContent = `Last seen ${ago}s ago - ${lastCall.endpoint}`;
    card.className = 'status-card';
  } else {
    dot.className = 'dot off';
    label.textContent = 'No AI agent connected';
    sub.textContent = 'Waiting for API calls...';
    card.className = 'status-card';
  }
}

function setSession(session, serverOnline) {
  const dot = document.getElementById('session-dot');
  const label = document.getElementById('session-label');
  const sub = document.getElementById('session-sub');
  const card = document.getElementById('session-card');
  const btn = document.getElementById('session-btn');
  const hint = document.getElementById('session-hint');

  const expiresIn = session?.expiresAt ? Math.max(0, session.expiresAt - Date.now()) : null;

  if (session?.active) {
    dot.className = 'dot ' + (session.connected ? 'on' : 'agent');
    label.textContent = session.connected ? 'Session live' : 'Session armed';

    const statusText = session.connected
      ? 'Browser control is enabled.'
      : serverOnline
        ? 'Waiting for the localhost bridge to reconnect.'
        : 'Waiting for the localhost bridge to start.';

    sub.textContent = expiresIn !== null
      ? `${statusText} Auto-stop in ${formatDuration(expiresIn)}.`
      : statusText;

    card.className = 'status-card active';
    btn.textContent = 'Stop session';
    btn.className = 'control-btn stop';
    hint.textContent = 'Manual stop is immediate. Idle timeout is 10m, hard cap is 30m.';
  } else {
    dot.className = 'dot off';
    label.textContent = 'Session idle';
    sub.textContent = describeStopReason(session?.stopReason);
    card.className = 'status-card';
    btn.textContent = 'Start session';
    btn.className = 'control-btn';
    hint.textContent = 'ClosedLoop stays disconnected until you explicitly start a session.';
  }

  btn.disabled = sessionActionPending;
}

async function poll() {
  const [statusResult, sessionResult] = await Promise.allSettled([
    fetch(`${SERVER}/status`, { signal: AbortSignal.timeout(2000) }).then((res) => res.json()),
    sendBackgroundMessage('get_session_state'),
  ]);

  const status = statusResult.status === 'fulfilled'
    ? statusResult.value
    : { extensionConnected: false, lastAgentCall: null };
  const session = sessionResult.status === 'fulfilled'
    ? sessionResult.value
    : { active: false, stopReason: 'idle' };

  const serverOnline = statusResult.status === 'fulfilled';
  const bridgeConnected = !!status.extensionConnected;

  const serverSub = serverOnline
    ? bridgeConnected
      ? 'Extension session connected to localhost.'
      : session.active
        ? 'Session is armed but the extension is not connected yet.'
        : 'Bridge is healthy. Start a session to connect the extension.'
    : 'http://localhost:9009';

  setServer(serverOnline, serverSub);
  setSession(session, serverOnline);

  const lastCall = status.lastAgentCall;
  const agentActive = lastCall && (Date.now() - lastCall.at) < AGENT_ACTIVE_WINDOW_MS;
  setAgent(agentActive, lastCall);
}

async function updateTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) {
    document.getElementById('tab-title').textContent = tab.title?.slice(0, 50) || '—';
    document.getElementById('tab-url').textContent = tab.url?.slice(0, 65) || '—';
  }
}

document.getElementById('start-cmd').textContent =
  'cd /path/to/closedloop && node mcp-server/server.js';

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

document.getElementById('session-btn').addEventListener('click', async () => {
  if (sessionActionPending) return;

  sessionActionPending = true;
  try {
    const current = await sendBackgroundMessage('get_session_state');
    if (current.active) {
      await sendBackgroundMessage('stop_session');
    } else {
      await sendBackgroundMessage('start_session');
    }
  } catch (error) {
    document.getElementById('session-sub').textContent = error.message;
  } finally {
    sessionActionPending = false;
    await poll();
  }
});

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

poll();
updateTab();
updateScreenshot();
setInterval(poll, 2000);
setInterval(updateScreenshot, 2000);
