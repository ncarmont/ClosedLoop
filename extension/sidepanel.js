const SERVER = 'http://localhost:9009';
const AGENT_ACTIVE_MS = 10_000;

const ICONS = {
  navigate_to:        { char: '→', cls: 'navigate'  },
  take_screenshot:    { char: '⬛', cls: 'screenshot' },
  click_element:      { char: '↖', cls: 'click'      },
  type_text:          { char: 'T', cls: 'type'       },
  get_page_context:   { char: '◎', cls: 'context'    },
  attach_debugger:    { char: '⬡', cls: 'debugger'  },
  detach_debugger:    { char: '⬡', cls: 'debugger'  },
  get_console_errors: { char: '!', cls: 'errors'     },
  get_network_errors: { char: '!', cls: 'errors'     },
  toggle_mobile:      { char: '📱', cls: 'navigate'  },
  request_approval:   { char: '?',  cls: 'errors'    },
};

function formatTime(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function iconFor(command) {
  return ICONS[command] || { char: '·', cls: 'default' };
}

// ── Render ────────────────────────────────────────────────────────────────────

let renderedIds = new Set();
let lastScreenshotEntryId = null;

function renderHistory(history, lastScreenshot) {
  const feed = document.getElementById('feed');
  const empty = document.getElementById('empty-state');
  const count = document.getElementById('footer-count');

  if (!history || history.length === 0) {
    empty.style.display = 'flex';
    count.textContent = '0 actions';
    return;
  }

  empty.style.display = 'none';
  count.textContent = `${history.length} action${history.length !== 1 ? 's' : ''}`;

  // Find the latest screenshot entry
  const latestScreenshotEntry = [...history].reverse().find(e => e.hasScreenshot);

  for (const entry of history) {
    if (renderedIds.has(entry.id)) {
      // Update screenshot if this is the latest screenshot entry and we now have data
      if (entry.hasScreenshot && entry.id === latestScreenshotEntry?.id && lastScreenshot) {
        const existingThumb = document.getElementById(`thumb-${entry.id}`);
        if (existingThumb && !existingThumb.querySelector('img')) {
          const img = document.createElement('img');
          img.src = lastScreenshot;
          img.alt = 'screenshot';
          existingThumb.appendChild(img);
        }
      }
      continue;
    }

    renderedIds.add(entry.id);

    const icon = iconFor(entry.command);
    const div = document.createElement('div');
    div.className = 'entry';
    div.dataset.id = entry.id;

    let html = `
      <div class="entry-meta">
        <div class="entry-icon ${icon.cls}">${icon.char}</div>
        <span class="entry-label">${escHtml(entry.label)}</span>
        <span class="entry-time">${formatTime(entry.timestamp)}</span>
      </div>
    `;
    if (entry.url) {
      html += `<div class="entry-url">${escHtml(entry.url)}</div>`;
    }
    if (entry.error) {
      html += `<div class="entry-error">Error: ${escHtml(entry.error)}</div>`;
    }
    if (entry.hasScreenshot) {
      const isLatest = entry.id === latestScreenshotEntry?.id;
      html += `<div class="screenshot-thumb" id="thumb-${entry.id}">`;
      if (isLatest && lastScreenshot) {
        html += `<img src="${lastScreenshot}" alt="screenshot" />`;
      }
      html += `</div>`;
    }

    div.innerHTML = html;
    feed.appendChild(div);
  }

  // Auto-scroll to bottom on new entries
  feed.scrollTop = feed.scrollHeight;
}

function escHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function getSessionState() {
  const response = await chrome.runtime.sendMessage({ type: 'get_session_state' });
  if (!response?.ok) {
    throw new Error(response?.error || 'Failed to read session state');
  }
  return response.session;
}

// ── Poll ──────────────────────────────────────────────────────────────────────

async function poll() {
  // Load action history from session storage
  // NOTE: chrome.storage.local is used (not session) — session is inaccessible from sidepanel context
  const sessionData = await chrome.storage.local.get('actionHistory').catch(() => ({}));
  const history = sessionData.actionHistory || [];

  // Load last screenshot from local storage
  const localData = await chrome.storage.local.get(['lastScreenshot', 'lastScreenshotTime']).catch(() => ({}));

  renderHistory(history, localData.lastScreenshot || null);

  // Check server for agent activity
  const dot = document.getElementById('status-dot');
  const text = document.getElementById('status-text');
  const banner = document.getElementById('agent-banner');

  try {
    const [statusResult, sessionResult] = await Promise.allSettled([
      fetch(`${SERVER}/status`, { signal: AbortSignal.timeout(1500) }).then((res) => res.json()),
      getSessionState(),
    ]);

    const serverOnline = statusResult.status === 'fulfilled';
    const status = serverOnline ? statusResult.value : { extensionConnected: false, lastAgentCall: null };
    const session = sessionResult.status === 'fulfilled' ? sessionResult.value : { active: false };
    const connected = !!status.extensionConnected;
    const lastCall = status.lastAgentCall;
    const agentActive = lastCall && (Date.now() - lastCall.at) < AGENT_ACTIVE_MS;

    if (agentActive) {
      dot.className = 'dot agent pulse';
      text.textContent = 'Agent active';
      banner.classList.add('visible');
    } else if (connected) {
      dot.className = 'dot on';
      text.textContent = 'Session live';
      banner.classList.remove('visible');
    } else if (session.active) {
      dot.className = 'dot agent';
      text.textContent = serverOnline ? 'Session armed' : 'Waiting for server';
      banner.classList.remove('visible');
    } else {
      dot.className = 'dot off';
      text.textContent = serverOnline ? 'Idle' : 'Server offline';
      banner.classList.remove('visible');
    }
  } catch {
    dot.className = 'dot off';
    text.textContent = 'Server offline';
    banner.classList.remove('visible');
  }
}

// ── Clear ─────────────────────────────────────────────────────────────────────

document.getElementById('clear-btn').addEventListener('click', async () => {
  await chrome.storage.local.set({ actionHistory: [] }).catch(() => {});
  renderedIds.clear();
  const feed = document.getElementById('feed');
  // Remove all entries, leave empty state
  const entries = feed.querySelectorAll('.entry');
  entries.forEach(e => e.remove());
  document.getElementById('empty-state').style.display = 'flex';
  document.getElementById('footer-count').textContent = '0 actions';
});

// ── Init ──────────────────────────────────────────────────────────────────────

poll();
setInterval(poll, 1500);
