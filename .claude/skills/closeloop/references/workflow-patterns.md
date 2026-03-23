# CloseLoop Workflow Patterns

Common multi-step recipes. Adapt selectors and URLs to the actual app.

---

## Pattern 1 — Verify a code change in the browser

Use after editing source files to confirm the change rendered correctly.

```bash
# Navigate (reloads the page with latest build)
curl -s -X POST http://localhost:9009/navigate \
  -H "Content-Type: application/json" \
  -d '{"url": "http://localhost:3000/the-page"}'

# Screenshot to confirm
curl -s -X POST http://localhost:9009/screenshot
# Read /tmp/closedloop-screenshot.png
```

For hot-reload dev servers, the page may already reflect changes — screenshot first to check before navigating.

---

## Pattern 2 — Fill and submit a form

```bash
# Discover real selectors first
curl -s http://localhost:9009/context

# Fill fields
curl -s -X POST http://localhost:9009/type \
  -H "Content-Type: application/json" \
  -d '{"selector": "#email", "text": "test@example.com"}'

curl -s -X POST http://localhost:9009/type \
  -H "Content-Type: application/json" \
  -d '{"selector": "#password", "text": "secret123"}'

# Submit
curl -s -X POST http://localhost:9009/click \
  -H "Content-Type: application/json" \
  -d '{"selector": "[type=\"submit\"]"}'

# Confirm result
curl -s -X POST http://localhost:9009/screenshot
# Read /tmp/closedloop-screenshot.png
```

---

## Pattern 3 — Debug a broken page

Full debugging session: attach debugger, navigate, capture all errors.

```bash
# Attach first — must precede navigation so errors are captured from page load
curl -s -X POST http://localhost:9009/attach-debugger

# Navigate to the broken page
curl -s -X POST http://localhost:9009/navigate \
  -H "Content-Type: application/json" \
  -d '{"url": "http://localhost:3000/broken"}'

# Screenshot to see current state
curl -s -X POST http://localhost:9009/screenshot
# Read /tmp/closedloop-screenshot.png

# Check what went wrong
curl -s http://localhost:9009/console-errors
curl -s http://localhost:9009/network-errors
```

---

## Pattern 4 — Click through a multi-step flow

```bash
# Step 1: navigate and confirm
curl -s -X POST http://localhost:9009/navigate \
  -H "Content-Type: application/json" \
  -d '{"url": "http://localhost:3000/checkout"}'
curl -s -X POST http://localhost:9009/screenshot
# Read /tmp/closedloop-screenshot.png

# Step 2: interact
curl -s http://localhost:9009/context  # discover selectors for this step
curl -s -X POST http://localhost:9009/click \
  -H "Content-Type: application/json" \
  -d '{"selector": "[data-testid=\"next-step\"]"}'

# Step 3: screenshot to verify transition
curl -s -X POST http://localhost:9009/screenshot
# Read /tmp/closedloop-screenshot.png

# Continue repeating: context → click/type → screenshot
```

---

## Pattern 5 — Test the demo calculator

The bundled demo has a broken calculator at `demo/calculator/`. Use it to practice:

```bash
# Get the file:// URL
CALC_PATH="file://$(pwd)/demo/calculator/index.html"

# Navigate
curl -s -X POST http://localhost:9009/navigate \
  -H "Content-Type: application/json" \
  -d "{\"url\": \"$CALC_PATH\"}"

# Attach debugger to catch JS errors
curl -s -X POST http://localhost:9009/attach-debugger

# Screenshot to see the calculator
curl -s -X POST http://localhost:9009/screenshot
# Read /tmp/closedloop-screenshot.png

# Get interactive elements (buttons, display)
curl -s http://localhost:9009/context

# Try pressing a button and check for errors
curl -s -X POST http://localhost:9009/click \
  -H "Content-Type: application/json" \
  -d '{"selector": "[data-key=\"5\"]"}'

curl -s http://localhost:9009/console-errors
curl -s -X POST http://localhost:9009/screenshot
# Read /tmp/closedloop-screenshot.png
```

---

## Pattern 6 — Search and interact

When the target element may not be on the current page:

```bash
# Navigate to a search page
curl -s -X POST http://localhost:9009/navigate \
  -H "Content-Type: application/json" \
  -d '{"url": "http://localhost:3000/search"}'

# Type a search query
curl -s -X POST http://localhost:9009/type \
  -H "Content-Type: application/json" \
  -d '{"selector": "input[type=\"search\"]", "text": "my query"}'

# Submit search (press Enter via a search button, or find the submit)
curl -s -X POST http://localhost:9009/click \
  -H "Content-Type: application/json" \
  -d '{"selector": "[type=\"submit\"]"}'

# Screenshot results
curl -s -X POST http://localhost:9009/screenshot
# Read /tmp/closedloop-screenshot.png

# Get context to find result links
curl -s http://localhost:9009/context

# Click first result
curl -s -X POST http://localhost:9009/click \
  -H "Content-Type: application/json" \
  -d '{"selector": ".search-result:first-child a"}'
```

---

## Tips for reliable automation

**Selector stability (best to worst):**
1. `#id` — most stable, unique by definition
2. `[data-testid="..."]` — explicit test hooks, very reliable
3. `[name="field"]` — stable for form inputs
4. `[aria-label="..."]` — stable for accessibility-compliant UIs
5. `.class-name` — fragile, changes with styling
6. `div > span:nth-child(2)` — breaks with any DOM change

**Page load timing:**
- `/navigate` waits for `load` event — but SPAs often render after that
- After navigating to a SPA route, take a screenshot first to check if content has rendered
- If the page appears blank, wait a moment and screenshot again before acting

**Error capture ordering:**
- Always call `/attach-debugger` before `/navigate` when debugging
- Errors captured only from after the debugger attaches
- Navigating to a new tab requires re-attaching the debugger

**Screenshot discipline:**
- Screenshot before and after every significant action
- Viewing the screenshot with `Read` is the only way to truly confirm page state
- Body text from `/context` can be stale or truncated — screenshots don't lie
