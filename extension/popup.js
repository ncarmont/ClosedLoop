const INSTRUCTIONS = `You now have access to ClosedLoop — a live bridge to my real Chrome browser via MCP tools.

**Available tools (MCP server name: closedloop):**
- \`get_page_context\` — get the current tab's URL, title, body text, and all interactive elements with CSS selectors
- \`take_screenshot\` — capture a PNG screenshot of the current visible tab
- \`click_element(selector)\` — click any element by CSS selector
- \`type_text(selector, text)\` — type into an input field by CSS selector
- \`navigate_to(url)\` — navigate the current tab to a URL and wait for it to load
- \`attach_debugger\` — attach Chrome DevTools to start capturing console errors and network failures
- \`get_console_errors\` — read all captured console errors/exceptions (call attach_debugger first)
- \`get_network_errors\` — read all captured network failures (call attach_debugger first)

**Start now:** Call \`attach_debugger\`, then \`take_screenshot\`, then \`get_page_context\` to see what is currently in my browser. You can interact with it directly — no need to ask me to click or check anything manually.`;

async function update() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) {
    document.getElementById('tab-title').textContent = tab.title?.slice(0, 50) || '—';
    document.getElementById('tab-url').textContent = tab.url?.slice(0, 65) || '—';
  }

  const badge = await chrome.action.getBadgeText({});
  const dot = document.getElementById('dot');
  const statusText = document.getElementById('status-text');
  if (badge === 'ON') {
    dot.className = 'dot on';
    statusText.textContent = 'Connected to MCP server';
  } else {
    dot.className = 'dot off';
    statusText.textContent = 'MCP server not running';
  }

  document.getElementById('config-path').innerHTML =
    `"closedloop": {<br>&nbsp;&nbsp;"command": "node",<br>&nbsp;&nbsp;"args": ["/path/to/closedloop/mcp-server/server.js"]<br>}`;
}

document.getElementById('copy-btn').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(INSTRUCTIONS);
    const label = document.getElementById('copy-label');
    const btn = document.getElementById('copy-btn');
    label.textContent = 'Copied!';
    btn.classList.add('copied');
    setTimeout(() => {
      label.textContent = 'Copy instructions for your AI';
      btn.classList.remove('copied');
    }, 2000);
  } catch (e) {
    // Fallback: select text from a temp element
    const ta = document.createElement('textarea');
    ta.value = INSTRUCTIONS;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  }
});

update();
setInterval(update, 2000);
