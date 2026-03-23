// ClosedLoop - background service worker
// Connects to the local MCP bridge at ws://localhost:9009

const WS_URL = 'ws://localhost:9009';
let ws = null;
let debuggingTabId = null;
let consoleErrors = [];
let networkErrors = [];

// Keep service worker alive via alarms
chrome.alarms.create('keepAlive', { periodInMinutes: 0.4 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'keepAlive') {
    if (!ws || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
      connect();
    }
  }
});

function connect() {
  try {
    ws = new WebSocket(WS_URL);
  } catch (e) {
    setBadge('OFF', '#ef4444');
    return;
  }

  ws.onopen = () => {
    setBadge('ON', '#22c55e');
  };

  ws.onmessage = async (event) => {
    let msg;
    try { msg = JSON.parse(event.data); } catch { return; }
    const result = await handleCommand(msg);
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ id: msg.id, result }));
    }
  };

  ws.onclose = () => {
    setBadge('OFF', '#ef4444');
    setTimeout(connect, 3000);
  };

  ws.onerror = () => {
    ws.close();
  };
}

function setBadge(text, color) {
  chrome.action.setBadgeText({ text });
  chrome.action.setBadgeBackgroundColor({ color });
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) throw new Error('No active tab found');
  return tab;
}

async function handleCommand(msg) {
  try {
    switch (msg.command) {
      case 'get_page_context':   return await getPageContext();
      case 'take_screenshot':    return await takeScreenshot();
      case 'click_element':      return await clickElement(msg.params);
      case 'type_text':          return await typeText(msg.params);
      case 'navigate_to':        return await navigateTo(msg.params);
      case 'attach_debugger':    return await attachDebugger();
      case 'detach_debugger':    return await detachDebugger();
      case 'get_console_errors': return { errors: consoleErrors.splice(0) };
      case 'get_network_errors': return { errors: networkErrors.splice(0) };
      default: return { error: `Unknown command: ${msg.command}` };
    }
  } catch (e) {
    return { error: e.message };
  }
}

async function getPageContext() {
  const tab = await getActiveTab();
  const [result] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => {
      const interactable = Array.from(
        document.querySelectorAll('button, input, select, textarea, a[href], [role="button"], [onclick]')
      ).slice(0, 40).map(el => {
        let selector = null;
        if (el.id) {
          selector = `#${CSS.escape(el.id)}`;
        } else if (el.getAttribute('data-testid')) {
          selector = `[data-testid="${el.getAttribute('data-testid')}"]`;
        } else if (el.getAttribute('name')) {
          selector = `${el.tagName.toLowerCase()}[name="${el.getAttribute('name')}"]`;
        } else if (el.getAttribute('aria-label')) {
          selector = `[aria-label="${el.getAttribute('aria-label')}"]`;
        }
        return {
          tag: el.tagName.toLowerCase(),
          text: (el.textContent?.trim() || el.value || el.placeholder || '').slice(0, 60),
          selector,
          type: el.getAttribute('type') || null,
          href: el.getAttribute('href') || null,
          disabled: el.disabled || false,
          placeholder: el.getAttribute('placeholder') || null,
        };
      }).filter(el => el.selector);

      return {
        url: location.href,
        title: document.title,
        bodyText: document.body?.innerText?.trim().slice(0, 3000) || '',
        interactable,
      };
    }
  });
  return result.result;
}

async function takeScreenshot() {
  const tab = await getActiveTab();
  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
  return { screenshot: dataUrl, url: tab.url, title: tab.title };
}

async function clickElement({ selector }) {
  const tab = await getActiveTab();
  const [result] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: (sel) => {
      let el;
      try { el = document.querySelector(sel); } catch (e) {
        return { error: `Invalid selector: ${sel}` };
      }
      if (!el) return { error: `No element found for: ${sel}` };
      el.scrollIntoView({ block: 'center', behavior: 'instant' });
      el.click();
      return { clicked: sel, tag: el.tagName.toLowerCase(), text: el.textContent?.trim().slice(0, 60) };
    },
    args: [selector]
  });
  return result.result;
}

async function typeText({ selector, text, clear = true }) {
  const tab = await getActiveTab();
  const [result] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: (sel, txt, clr) => {
      let el;
      try { el = document.querySelector(sel); } catch (e) {
        return { error: `Invalid selector: ${sel}` };
      }
      if (!el) return { error: `No element found for: ${sel}` };
      el.focus();
      // React-compatible value setting
      const proto = el instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
      const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      const newVal = clr ? txt : (el.value + txt);
      if (nativeSetter) {
        nativeSetter.call(el, newVal);
      } else {
        el.value = newVal;
      }
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return { typed: txt, into: sel, cleared: clr };
    },
    args: [selector, text, clear]
  });
  return result.result;
}

async function navigateTo({ url }) {
  const tab = await getActiveTab();
  await chrome.tabs.update(tab.id, { url });
  await new Promise((resolve) => {
    const listener = (tabId, info) => {
      if (tabId === tab.id && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
    setTimeout(resolve, 12000);
  });
  const updated = await chrome.tabs.get(tab.id);
  return { navigated: url, title: updated.title };
}

async function attachDebugger() {
  const tab = await getActiveTab();
  if (debuggingTabId !== tab.id) {
    if (debuggingTabId) {
      try { await chrome.debugger.detach({ tabId: debuggingTabId }); } catch {}
    }
    try {
      await chrome.debugger.attach({ tabId: tab.id }, '1.3');
    } catch (e) {
      if (!e.message?.includes('already attached')) throw e;
    }
    debuggingTabId = tab.id;
  }
  consoleErrors = [];
  networkErrors = [];
  await chrome.debugger.sendCommand({ tabId: tab.id }, 'Runtime.enable');
  await chrome.debugger.sendCommand({ tabId: tab.id }, 'Network.enable');
  return { attached: true, tabId: tab.id, url: tab.url };
}

async function detachDebugger() {
  if (debuggingTabId) {
    try { await chrome.debugger.detach({ tabId: debuggingTabId }); } catch {}
    debuggingTabId = null;
  }
  return { detached: true };
}

chrome.debugger.onEvent.addListener((source, method, params) => {
  if (source.tabId !== debuggingTabId) return;

  if (method === 'Runtime.consoleAPICalled') {
    if (params.type === 'error' || params.type === 'warning') {
      consoleErrors.push({
        type: params.type,
        message: (params.args || []).map(a => a.value ?? a.description ?? '').join(' '),
        timestamp: Date.now(),
      });
    }
  } else if (method === 'Runtime.exceptionThrown') {
    const details = params.exceptionDetails;
    consoleErrors.push({
      type: 'exception',
      message: details?.text || details?.exception?.description || 'Uncaught exception',
      url: details?.url,
      line: details?.lineNumber,
      timestamp: Date.now(),
    });
  } else if (method === 'Network.loadingFailed') {
    networkErrors.push({
      type: 'load_failed',
      requestId: params.requestId,
      error: params.errorText,
      timestamp: Date.now(),
    });
  } else if (method === 'Network.responseReceived') {
    const status = params.response?.status;
    if (status >= 400) {
      networkErrors.push({
        type: 'http_error',
        url: params.response.url,
        status,
        timestamp: Date.now(),
      });
    }
  }
});

// Detach debugger when tab is closed
chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === debuggingTabId) debuggingTabId = null;
});

connect();
