import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { WebSocketServer } from 'ws';

const WS_PORT = 9009;

// ── WebSocket bridge (extension connects here) ────────────────────────────────

const wss = new WebSocketServer({ port: WS_PORT, host: 'localhost' });
let extensionSocket = null;
const pending = new Map();
let nextId = 1;

wss.on('connection', (socket) => {
  extensionSocket = socket;
  process.stderr.write('[ClosedLoop] Chrome extension connected\n');

  socket.on('message', (data) => {
    try {
      const msg = JSON.parse(data);
      const resolve = pending.get(msg.id);
      if (resolve) {
        pending.delete(msg.id);
        resolve(msg.result);
      }
    } catch {}
  });

  socket.on('close', () => {
    extensionSocket = null;
    process.stderr.write('[ClosedLoop] Chrome extension disconnected\n');
  });
});

async function send(command, params = {}) {
  if (!extensionSocket || extensionSocket.readyState !== 1 /* OPEN */) {
    throw new Error(
      'ClosedLoop Chrome extension is not connected. ' +
      'Make sure the extension is installed and the popup shows "Connected".'
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

// ── Tool definitions ──────────────────────────────────────────────────────────

const TOOLS = [
  {
    name: 'get_page_context',
    description:
      'Get the URL, title, visible body text (up to 3000 chars), and a list of ' +
      'interactive elements (buttons, inputs, links) with their CSS selectors. ' +
      'Always call this first to understand what is on the page.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'take_screenshot',
    description:
      'Capture a screenshot of the current visible tab as a PNG image. ' +
      'Use this to visually verify layouts, check for rendering bugs, or confirm a fix.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'click_element',
    description: 'Click an element in the current tab using a CSS selector.',
    inputSchema: {
      type: 'object',
      properties: {
        selector: {
          type: 'string',
          description: 'CSS selector for the element to click (e.g. "#submit-btn", "[data-testid=\\"save\\"]")',
        },
      },
      required: ['selector'],
    },
  },
  {
    name: 'type_text',
    description: 'Focus an input/textarea and type text into it.',
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector for the input element' },
        text: { type: 'string', description: 'Text to type' },
        clear: { type: 'boolean', description: 'Clear the field before typing (default: true)' },
      },
      required: ['selector', 'text'],
    },
  },
  {
    name: 'navigate_to',
    description: 'Navigate the current tab to a URL and wait for the page to finish loading.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Absolute URL to navigate to' },
      },
      required: ['url'],
    },
  },
  {
    name: 'attach_debugger',
    description:
      'Attach the Chrome debugger to the current tab to start capturing console errors ' +
      'and network failures. Call this before get_console_errors or get_network_errors. ' +
      'Resets the error buffers each time it is called.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_console_errors',
    description:
      'Return all console errors, warnings, and uncaught exceptions captured since ' +
      'attach_debugger was last called. Returns and clears the buffer.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_network_errors',
    description:
      'Return all HTTP 4xx/5xx responses and failed network requests captured since ' +
      'attach_debugger was last called. Returns and clears the buffer.',
    inputSchema: { type: 'object', properties: {} },
  },
];

// ── MCP server ────────────────────────────────────────────────────────────────

const server = new Server(
  { name: 'closedloop', version: '0.1.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  const validTools = new Set(TOOLS.map(t => t.name));
  if (!validTools.has(name)) {
    throw new Error(`Unknown tool: ${name}`);
  }

  const result = await send(name, args || {});

  if (name === 'take_screenshot' && result?.screenshot) {
    const base64 = result.screenshot.replace(/^data:image\/\w+;base64,/, '');
    return {
      content: [
        { type: 'image', data: base64, mimeType: 'image/png' },
        { type: 'text', text: `URL: ${result.url}\nTitle: ${result.title}` },
      ],
    };
  }

  if (result?.error) {
    return {
      content: [{ type: 'text', text: `Error: ${result.error}` }],
      isError: true,
    };
  }

  return {
    content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
  };
});

const transport = new StdioServerTransport();
await server.connect(transport);
process.stderr.write(
  `[ClosedLoop] MCP server running (stdio). ` +
  `Waiting for Chrome extension on ws://localhost:${WS_PORT}\n`
);
