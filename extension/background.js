// ClosedLoop - background service worker
// Connects to the local MCP bridge at ws://localhost:9009

const WS_URL = 'ws://localhost:9009';
let ws = null;
let debuggingTabId = null;
let consoleErrors = [];
let networkErrors = [];

// ── Agent banner pill ──────────────────────────────────────────────────────────
//
// Small pill at the top of the page — animated gradient, auto-fades after 9s.
// Also purges any leftover full-page ring from old extension versions.

function showAgentRing(tabId) {
  chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      const BANNER_ID = '__closeloop_ring__';
      const STYLE_ID  = '__closeloop_ring_style__';

      // Remove any existing banner or old full-page ring overlay
      const existing = document.getElementById(BANNER_ID);
      if (existing) {
        clearTimeout(existing.__cl_timer);
        existing.remove();
      }
      document.getElementById(STYLE_ID)?.remove();

      const style = document.createElement('style');
      style.id = STYLE_ID;
      style.textContent = `
        @keyframes __cl_banner_sweep__ {
          0%   { background-position: 0% 50%; }
          100% { background-position: 300% 50%; }
        }
        @keyframes __cl_banner_in__ {
          from { opacity: 0; transform: translateX(-50%) translateY(-6px) scale(0.96); }
          to   { opacity: 1; transform: translateX(-50%) translateY(0)     scale(1); }
        }
      `;
      document.head.appendChild(style);

      const banner = document.createElement('div');
      banner.id = BANNER_ID;
      banner.textContent = '✦ An AI agent is controlling this browser tab';
      banner.style.cssText = `
        position: fixed;
        top: 14px;
        left: 50%;
        transform: translateX(-50%);
        z-index: 2147483647;
        background: linear-gradient(90deg, #4c1d95, #7c3aed, #a78bfa, #c4b5fd, #a78bfa, #7c3aed, #4c1d95);
        background-size: 300% 100%;
        color: #fff;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        font-size: 12px;
        font-weight: 600;
        padding: 6px 18px;
        border-radius: 999px;
        pointer-events: none;
        white-space: nowrap;
        border: 1px solid rgba(196,181,253,0.35);
        box-shadow: 0 2px 14px rgba(124,58,237,0.45);
        animation: __cl_banner_sweep__ 4s linear infinite, __cl_banner_in__ 0.25s ease forwards;
        transition: opacity 0.7s ease;
      `;

      document.body.appendChild(banner);

      banner.__cl_timer = setTimeout(() => {
        banner.style.opacity = '0';
        setTimeout(() => {
          banner.remove();
          document.getElementById(STYLE_ID)?.remove();
        }, 700);
      }, 9000);
    },
  }).catch(() => {});
}

// ── Injected sidebar (replaces chrome.sidePanel — works without user gesture) ──
//
// chrome.sidePanel.open() is silently blocked when called outside a user gesture
// (e.g. from a WebSocket message handler in a service worker). Instead we inject
// a fixed-position overlay directly into the page DOM via executeScript, which
// has no gesture restriction.

async function injectSidebar(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        if (document.getElementById('__closeloop_sidebar__')) return;

        // ── Styles ──────────────────────────────────────────────────────────
        const style = document.createElement('style');
        style.id = '__cl_style__';
        style.textContent = `
          #__closeloop_sidebar__ {
            position: fixed !important; top: 0 !important; right: 0 !important;
            width: 300px !important; height: 100vh !important;
            z-index: 2147483646 !important; background: #0f172a !important;
            border-left: 1px solid #1e3a5f !important;
            display: flex !important; flex-direction: column !important;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif !important;
            box-shadow: -8px 0 40px rgba(0,0,0,0.7) !important;
            color: #f1f5f9 !important; overflow: hidden !important;
          }
          #__cl_hdr__ {
            display: flex !important; align-items: center !important;
            gap: 8px !important; padding: 11px 14px !important;
            border-bottom: 1px solid #1e293b !important; flex-shrink: 0 !important;
            background: #0a0f1e !important;
          }
          #__cl_hdr__ .__cl_logo__ {
            font-size: 13px !important; font-weight: 700 !important;
            color: #fff !important; letter-spacing: -0.3px !important;
          }
          #__cl_hdr__ .__cl_badge__ {
            font-size: 9px !important; font-weight: 600 !important;
            background: #7c3aed !important; color: #fff !important;
            padding: 2px 5px !important; border-radius: 3px !important;
            letter-spacing: 0.5px !important;
          }
          #__cl_close__ {
            margin-left: auto !important; background: none !important;
            border: none !important; color: #475569 !important;
            cursor: pointer !important; font-size: 15px !important;
            padding: 2px 6px !important; border-radius: 4px !important;
            line-height: 1 !important; transition: all 0.15s !important;
          }
          #__cl_close__:hover { color: #f1f5f9 !important; background: #1e293b !important; }

          #__cl_debug_banner__ {
            align-items: center !important; gap: 8px !important;
            padding: 7px 14px !important; background: #1c0e0e !important;
            border-bottom: 1px solid #3b0f0f !important;
            font-size: 11px !important; font-weight: 500 !important;
            color: #fca5a5 !important; flex-shrink: 0 !important;
            display: none !important;
          }
          #__cl_debug_banner__.__cl_on__ { display: flex !important; }
          .__cl_dbg_dot__ {
            width: 7px !important; height: 7px !important;
            border-radius: 50% !important; background: #ef4444 !important;
            box-shadow: 0 0 5px #ef444480 !important; flex-shrink: 0 !important;
            animation: __cl_dbgpulse__ 2s ease-in-out infinite !important;
          }
          @keyframes __cl_dbgpulse__ { 0%,100%{opacity:1} 50%{opacity:0.35} }

          #__cl_feed__ {
            flex: 1 !important; overflow-y: auto !important; padding: 6px 0 !important;
          }
          #__cl_feed__::-webkit-scrollbar { width: 3px !important; }
          #__cl_feed__::-webkit-scrollbar-track { background: transparent !important; }
          #__cl_feed__::-webkit-scrollbar-thumb { background: #1e293b !important; border-radius: 2px !important; }
          .__cl_empty__ {
            padding: 28px 16px !important; text-align: center !important;
            color: #1e3a5f !important; font-size: 12px !important;
            line-height: 1.6 !important;
          }
          .__cl_entry__ {
            padding: 8px 14px !important; border-bottom: 1px solid #0f1c2e !important;
            animation: __cl_fadein__ 0.18s ease !important;
          }
          @keyframes __cl_fadein__ { from{opacity:0;transform:translateY(3px)} to{opacity:1;transform:translateY(0)} }
          .__cl_meta__ { display: flex !important; align-items: center !important; gap: 7px !important; }
          .__cl_icon__ {
            width: 20px !important; height: 20px !important; border-radius: 5px !important;
            display: flex !important; align-items: center !important; justify-content: center !important;
            font-size: 10px !important; flex-shrink: 0 !important; font-style: normal !important;
          }
          .__cl_i_nav__  { background:#0c2340!important; color:#38bdf8!important; }
          .__cl_i_shot__ { background:#0f2230!important; color:#818cf8!important; }
          .__cl_i_clk__  { background:#1a1a2e!important; color:#c084fc!important; }
          .__cl_i_typ__  { background:#0f1f1a!important; color:#34d399!important; }
          .__cl_i_ctx__  { background:#1c1a10!important; color:#fbbf24!important; }
          .__cl_i_dbg__  { background:#1c1010!important; color:#f87171!important; }
          .__cl_i_err__  { background:#1c0e0e!important; color:#fb923c!important; }
          .__cl_i_def__  { background:#1e293b!important; color:#94a3b8!important; }
          .__cl_lbl__ {
            font-size: 11px !important; font-weight: 500 !important; color: #e2e8f0 !important;
            flex: 1 !important; overflow: hidden !important; white-space: nowrap !important;
            text-overflow: ellipsis !important;
          }
          .__cl_time__ { font-size: 10px !important; color: #334155 !important; flex-shrink: 0 !important; }
          .__cl_url__ {
            font-size: 10px !important; color: #334155 !important; margin-top: 2px !important;
            padding-left: 27px !important; overflow: hidden !important;
            white-space: nowrap !important; text-overflow: ellipsis !important;
          }
          .__cl_err__ { font-size:10px!important; color:#f87171!important; margin-top:2px!important; padding-left:27px!important; }
          .__cl_thumb__ {
            margin-top: 7px !important; border-radius: 6px !important;
            overflow: hidden !important; border: 1px solid #1e293b !important;
          }
          .__cl_thumb__ img { width:100%!important; display:block!important; }

          #__cl_footer__ {
            padding: 7px 14px !important; border-top: 1px solid #1e293b !important;
            display: flex !important; align-items: center !important;
            justify-content: space-between !important;
            flex-shrink: 0 !important; background: #0a0f1e !important;
          }
          #__cl_count__ { font-size: 10px !important; color: #334155 !important; }
          #__cl_clear__ {
            font-size: 10px !important; color: #334155 !important;
            background: none !important; border: none !important;
            cursor: pointer !important; padding: 2px 6px !important; border-radius: 4px !important;
          }
          #__cl_clear__:hover { background:#1e293b!important; color:#94a3b8!important; }

          #__cl_approval_card__ {
            margin: 8px 10px !important; border-radius: 8px !important;
            border: 1.5px solid #f59e0b !important; background: #1a1100 !important;
            padding: 11px 12px !important; flex-shrink: 0 !important;
            animation: __cl_fadein__ 0.2s ease !important;
          }
          .__cl_appr_title__ {
            font-size: 11px !important; font-weight: 700 !important;
            color: #fcd34d !important; margin-bottom: 5px !important;
          }
          .__cl_appr_action__ {
            font-size: 11px !important; color: #e2e8f0 !important;
            margin-bottom: 3px !important; line-height: 1.4 !important;
          }
          .__cl_appr_reason__ {
            font-size: 10px !important; color: #94a3b8 !important;
            margin-bottom: 9px !important; line-height: 1.4 !important;
          }
          .__cl_appr_btns__ { display: flex !important; gap: 7px !important; }
          .__cl_appr_approve__ {
            flex: 1 !important; padding: 6px 0 !important;
            background: #052e16 !important; border: 1.5px solid #16a34a !important;
            color: #4ade80 !important; border-radius: 6px !important;
            cursor: pointer !important; font-size: 11px !important;
            font-weight: 700 !important; transition: background 0.15s !important;
          }
          .__cl_appr_approve__:hover { background: #14532d !important; }
          .__cl_appr_deny__ {
            flex: 1 !important; padding: 6px 0 !important;
            background: #450a0a !important; border: 1.5px solid #dc2626 !important;
            color: #f87171 !important; border-radius: 6px !important;
            cursor: pointer !important; font-size: 11px !important;
            font-weight: 700 !important; transition: background 0.15s !important;
          }
          .__cl_appr_deny__:hover { background: #7f1d1d !important; }
          .__cl_i_appr__ { background:#1a1100!important; color:#fcd34d!important; }

          #__cl_tab__ {
            position: fixed !important; top: 50% !important; right: 0 !important;
            transform: translateY(-50%) !important; z-index: 2147483646 !important;
            background: #7c3aed !important; color: #fff !important;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif !important;
            font-size: 9px !important; font-weight: 700 !important;
            padding: 10px 5px !important; border-radius: 6px 0 0 6px !important;
            cursor: pointer !important; writing-mode: vertical-rl !important;
            letter-spacing: 1px !important;
            box-shadow: -3px 0 12px rgba(124,58,237,0.5) !important;
            display: none !important; border: none !important;
          }
        `;
        document.head.appendChild(style);

        // ── HTML ─────────────────────────────────────────────────────────────
        const sidebar = document.createElement('div');
        sidebar.id = '__closeloop_sidebar__';
        sidebar.innerHTML = `
          <div id="__cl_hdr__">
            <span class="__cl_logo__">ClosedLoop</span>
            <span class="__cl_badge__">BETA</span>
            <button id="__cl_close__" title="Close">✕</button>
          </div>
          <div id="__cl_debug_banner__">
            <span class="__cl_dbg_dot__"></span>
            Chrome is being debugged
          </div>
          <div id="__cl_feed__">
            <div class="__cl_empty__">No actions yet.<br>Waiting for agent commands...</div>
          </div>
          <div id="__cl_footer__">
            <span id="__cl_count__">0 actions</span>
            <button id="__cl_clear__">Clear</button>
          </div>
        `;
        document.body.appendChild(sidebar);

        // Collapsed re-open tab
        const tab = document.createElement('button');
        tab.id = '__cl_tab__';
        tab.textContent = 'CL';
        tab.title = 'Open ClosedLoop panel';
        document.body.appendChild(tab);

        // ── Events ───────────────────────────────────────────────────────────
        document.getElementById('__cl_close__').addEventListener('click', () => {
          sidebar.style.display = 'none';
          tab.style.display = 'block';
        });
        tab.addEventListener('click', () => {
          sidebar.style.display = 'flex';
          tab.style.display = 'none';
        });
        document.getElementById('__cl_clear__').addEventListener('click', async () => {
          await chrome.storage.local.set({ actionHistory: [] }).catch(() => {});
          renderedIds.clear();
          const feed = document.getElementById('__cl_feed__');
          if (feed) feed.innerHTML = '<div class="__cl_empty__">Cleared. Waiting for next action...</div>';
          const c = document.getElementById('__cl_count__');
          if (c) c.textContent = '0 actions';
        });

        // ── Renderer ─────────────────────────────────────────────────────────
        const ICONS = {
          navigate_to:        ['→', '__cl_i_nav__' ],
          take_screenshot:    ['▣', '__cl_i_shot__'],
          click_element:      ['↖', '__cl_i_clk__' ],
          type_text:          ['T', '__cl_i_typ__' ],
          get_page_context:   ['◎', '__cl_i_ctx__' ],
          attach_debugger:    ['⬡', '__cl_i_dbg__' ],
          detach_debugger:    ['⬡', '__cl_i_dbg__' ],
          get_console_errors: ['!', '__cl_i_err__' ],
          get_network_errors: ['!', '__cl_i_err__' ],
          request_approval:   ['?', '__cl_i_appr__'],
          toggle_mobile:      ['📱','__cl_i_nav__' ],
        };

        function esc(s) {
          return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
        }
        function fmt(ts) {
          return new Date(ts).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',second:'2-digit'});
        }

        const renderedIds = new Set();

        function render(history, lastScreenshot, debuggerActive) {
          // Debugger banner — always shown while debugger is attached
          const banner = document.getElementById('__cl_debug_banner__');
          if (banner) {
            if (debuggerActive) banner.classList.add('__cl_on__');
            else banner.classList.remove('__cl_on__');
          }

          const feed = document.getElementById('__cl_feed__');
          const countEl = document.getElementById('__cl_count__');
          if (!feed) return;

          if (!history || history.length === 0) return;

          const empty = feed.querySelector('.__cl_empty__');
          if (empty) empty.remove();

          if (countEl) countEl.textContent = `${history.length} action${history.length !== 1 ? 's' : ''}`;

          const latestShot = [...history].reverse().find(e => e.hasScreenshot);

          for (const entry of history) {
            if (renderedIds.has(entry.id)) {
              // Backfill screenshot thumbnail once image arrives
              if (entry.hasScreenshot && entry.id === latestShot?.id && lastScreenshot) {
                const thumb = document.getElementById(`__cl_t_${entry.id}__`);
                if (thumb && !thumb.querySelector('img')) {
                  const img = document.createElement('img');
                  img.src = lastScreenshot;
                  thumb.appendChild(img);
                }
              }
              continue;
            }
            renderedIds.add(entry.id);

            const [char, cls] = ICONS[entry.command] || ['·', '__cl_i_def__'];
            const div = document.createElement('div');
            div.className = '__cl_entry__';

            let html = `<div class="__cl_meta__">
              <span class="__cl_icon__ ${cls}">${char}</span>
              <span class="__cl_lbl__">${esc(entry.label)}</span>
              <span class="__cl_time__">${fmt(entry.timestamp)}</span>
            </div>`;
            if (entry.url)   html += `<div class="__cl_url__">${esc(entry.url)}</div>`;
            if (entry.error) html += `<div class="__cl_err__">✕ ${esc(entry.error)}</div>`;
            if (entry.hasScreenshot) {
              const isLatest = entry.id === latestShot?.id;
              html += `<div class="__cl_thumb__" id="__cl_t_${entry.id}__">`;
              if (isLatest && lastScreenshot) html += `<img src="${lastScreenshot}" alt="" />`;
              html += '</div>';
            }
            div.innerHTML = html;
            feed.appendChild(div);
          }

          feed.scrollTop = feed.scrollHeight;
        }

        // ── Approval card ─────────────────────────────────────────────────
        function renderApproval(approval) {
          const sidebar = document.getElementById('__closeloop_sidebar__');
          const feed    = document.getElementById('__cl_feed__');
          if (!sidebar || !feed) return;

          let card = document.getElementById('__cl_approval_card__');

          if (!approval) {
            card?.remove();
            return;
          }

          if (card) {
            // Update text in place
            const a = card.querySelector('.__cl_appr_action__');
            const r = card.querySelector('.__cl_appr_reason__');
            if (a) a.textContent = approval.action || '';
            if (r) r.textContent = approval.reason ? `Reason: ${approval.reason}` : '';
            return;
          }

          card = document.createElement('div');
          card.id = '__cl_approval_card__';

          const reasonHtml = approval.reason
            ? `<div class="__cl_appr_reason__">Reason: ${esc(approval.reason)}</div>`
            : '';

          card.innerHTML = `
            <div class="__cl_appr_title__">⚠ Approval Required</div>
            <div class="__cl_appr_action__">${esc(approval.action || 'Proceed with action')}</div>
            ${reasonHtml}
            <div class="__cl_appr_btns__">
              <button class="__cl_appr_approve__">✓ Approve</button>
              <button class="__cl_appr_deny__">✕ Deny</button>
            </div>
          `;

          card.querySelector('.__cl_appr_approve__').addEventListener('click', async () => {
            await chrome.storage.local.set({ approvalResponse: 'approved' }).catch(() => {});
            card.innerHTML = '<div style="text-align:center;padding:8px;font-size:11px;color:#4ade80;font-family:-apple-system,sans-serif">✓ Approved — continuing</div>';
            setTimeout(() => card.remove(), 1800);
          });

          card.querySelector('.__cl_appr_deny__').addEventListener('click', async () => {
            await chrome.storage.local.set({ approvalResponse: 'denied' }).catch(() => {});
            card.innerHTML = '<div style="text-align:center;padding:8px;font-size:11px;color:#f87171;font-family:-apple-system,sans-serif">✕ Denied — action cancelled</div>';
            setTimeout(() => card.remove(), 1800);
          });

          sidebar.insertBefore(card, feed);
        }

        // ── Poll ─────────────────────────────────────────────────────────────
        async function update() {
          const [s, l, a] = await Promise.all([
            chrome.storage.local.get('actionHistory').catch(() => ({})),
            chrome.storage.local.get(['lastScreenshot', 'debuggerActive']).catch(() => ({})),
            chrome.storage.local.get('pendingApproval').catch(() => ({})),
          ]);
          render(s.actionHistory || [], l.lastScreenshot || null, !!l.debuggerActive);
          renderApproval(a.pendingApproval || null);
        }

        setInterval(update, 1500);
        update();
      },
    });
  } catch {}
}

// ── Pre-action element highlight ──────────────────────────────────────────────
//
// Called before click/type so the user can see exactly what element is about
// to be acted on. Injects a glowing border + action label onto the target,
// waits briefly, then the caller proceeds with the real action.

async function highlightElement(tabId, selector, actionLabel) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: async (sel, label) => {
        const OVERLAY_ID = '__cl_pre_action__';
        const BADGE_ID   = '__cl_pre_badge__';
        const STYLE_ID   = '__cl_pre_style__';

        document.getElementById(OVERLAY_ID)?.remove();
        document.getElementById(BADGE_ID)?.remove();

        if (!document.getElementById(STYLE_ID)) {
          const s = document.createElement('style');
          s.id = STYLE_ID;
          s.textContent = `
            @keyframes __cl_pre_ring__ {
              0%,100% {
                box-shadow:
                  0 0 0 3px #f59e0b,
                  0 0 24px 10px #f59e0baa,
                  0 0 70px 28px #f59e0b55;
                border-color: #f59e0b;
              }
              50% {
                box-shadow:
                  0 0 0 5px #fcd34d,
                  0 0 48px 20px #f59e0bdd,
                  0 0 110px 50px #f59e0b77;
                border-color: #fcd34d;
              }
            }
            @keyframes __cl_pre_badge_in__ {
              from { opacity: 0; transform: translateY(5px) scale(0.94); }
              to   { opacity: 1; transform: translateY(0) scale(1); }
            }
            @keyframes __cl_pre_drain__ {
              from { width: 100%; }
              to   { width: 0%; }
            }
          `;
          document.head.appendChild(s);
        }

        let el;
        try { el = document.querySelector(sel); } catch { return; }
        if (!el) return;

        // Instant scroll so layout is settled before we capture rect
        el.scrollIntoView({ block: 'center', behavior: 'instant' });
        // One animation frame to let the browser commit the scroll position
        await new Promise(r => requestAnimationFrame(r));

        const rect = el.getBoundingClientRect();
        const pad = 7;
        const w = Math.max(rect.width  + pad * 2, 32);
        const h = Math.max(rect.height + pad * 2, 32);

        // ── Spotlight overlay ────────────────────────────────────────────────
        const overlay = document.createElement('div');
        overlay.id = OVERLAY_ID;
        overlay.style.cssText = `
          position: fixed;
          top:    ${rect.top    - pad}px;
          left:   ${rect.left   - pad}px;
          width:  ${w}px;
          height: ${h}px;
          border: 3px solid #f59e0b;
          border-radius: 9px;
          pointer-events: none;
          z-index: 2147483645;
          animation: __cl_pre_ring__ 0.9s ease-in-out infinite;
        `;

        // ── Label badge ──────────────────────────────────────────────────────
        const badge = document.createElement('div');
        badge.id = BADGE_ID;

        const BADGE_H = 50;
        const spaceAbove = rect.top - pad;
        const arrowDown  = spaceAbove > BADGE_H + 10;
        const badgeTop   = arrowDown
          ? rect.top - pad - BADGE_H - 8
          : rect.bottom + pad + 8;
        const badgeLeft  = Math.max(8, Math.min(rect.left - pad, window.innerWidth - 270));

        badge.style.cssText = `
          position: fixed;
          top:  ${badgeTop}px;
          left: ${badgeLeft}px;
          background: #f59e0b;
          color: #000;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          font-size: 12px;
          font-weight: 800;
          padding: 7px 13px 9px;
          border-radius: 9px;
          pointer-events: none;
          z-index: 2147483646;
          white-space: nowrap;
          min-width: 170px;
          box-shadow: 0 6px 28px rgba(0,0,0,0.7), 0 0 0 1.5px #fcd34d;
          animation: __cl_pre_badge_in__ 0.15s ease forwards;
        `;

        // Triangle arrow pointing toward the element
        const arrow = document.createElement('div');
        arrow.style.cssText = `
          position: absolute;
          ${arrowDown ? 'bottom:-8px' : 'top:-8px'};
          left: 16px;
          width: 0; height: 0;
          border-left: 8px solid transparent;
          border-right: 8px solid transparent;
          ${arrowDown ? 'border-top: 8px solid #f59e0b;' : 'border-bottom: 8px solid #f59e0b;'}
        `;
        badge.appendChild(arrow);

        const labelNode = document.createElement('div');
        labelNode.style.cssText = 'font-size:12px;font-weight:800;letter-spacing:0.02em;line-height:1.3;';
        labelNode.textContent = label;
        badge.appendChild(labelNode);

        // Countdown drain bar
        const drain = document.createElement('div');
        drain.style.cssText = `
          height: 3px;
          background: rgba(0,0,0,0.35);
          border-radius: 2px;
          margin-top: 6px;
          animation: __cl_pre_drain__ 2s linear forwards;
        `;
        badge.appendChild(drain);

        document.body.appendChild(overlay);
        document.body.appendChild(badge);
      },
      args: [selector, actionLabel],
    });
  } catch {}
}

async function removeElementHighlight(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        document.getElementById('__cl_pre_action__')?.remove();
        document.getElementById('__cl_pre_badge__')?.remove();
      },
    });
  } catch {}
}

// ── Approval bubble + request ──────────────────────────────────────────────────
//
// showApprovalBubble injects a centered attention overlay on the page so the
// user immediately knows to look at the side panel and click Approve or Deny.

function showApprovalBubble(tabId) {
  chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      document.getElementById('__cl_approval_bubble__')?.remove();

      if (!document.getElementById('__cl_bubble_style__')) {
        const s = document.createElement('style');
        s.id = '__cl_bubble_style__';
        s.textContent = `
          @keyframes __cl_bubble_pulse__ {
            0%,100% { box-shadow: 0 0 0 1px #f59e0b50, 0 8px 40px #000c, 0 0 40px #f59e0b28; }
            50%      { box-shadow: 0 0 0 3px #f59e0ba0, 0 8px 40px #000c, 0 0 80px #f59e0b50; }
          }
          @keyframes __cl_arrow_bob__ {
            0%,100% { transform: translateX(0); }
            50%      { transform: translateX(5px); }
          }
        `;
        document.head.appendChild(s);
      }

      const bubble = document.createElement('div');
      bubble.id = '__cl_approval_bubble__';
      bubble.style.cssText = `
        position: fixed;
        top: 50%; left: 50%;
        transform: translate(-50%, -50%);
        z-index: 2147483646;
        background: rgba(26,17,0,0.97);
        border: 2px solid #f59e0b;
        border-radius: 18px;
        padding: 22px 32px;
        text-align: center;
        pointer-events: none;
        min-width: 260px;
        max-width: 340px;
        animation: __cl_bubble_pulse__ 1.8s ease-in-out infinite;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      `;
      bubble.innerHTML = `
        <div style="font-size:13px;font-weight:700;color:#fcd34d;margin-bottom:10px;letter-spacing:0.01em;">
          ⚠ Action needs your approval
        </div>
        <div style="font-size:13px;color:#e2e8f0;line-height:1.5;display:flex;align-items:center;justify-content:center;gap:8px;">
          <span>Please approve in the side panel</span>
          <span style="font-size:18px;animation:__cl_arrow_bob__ 0.8s ease-in-out infinite;display:inline-block;">👉</span>
        </div>
      `;
      document.body.appendChild(bubble);
    },
  }).catch(() => {});
}

function removeApprovalBubble(tabId) {
  chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      document.getElementById('__cl_approval_bubble__')?.remove();
      document.getElementById('__cl_bubble_style__')?.remove();
    },
  }).catch(() => {});
}

async function requestApproval({ action = 'Proceed with action', reason = '' } = {}) {
  const tab = await getActiveTab();

  // Make sure the sidebar is visible so the user can see the approval card
  showAgentRing(tab.id);
  await injectSidebar(tab.id);

  // Write the pending request — injected sidebar polls and renders the card
  await chrome.storage.local.set({
    pendingApproval: { action, reason, timestamp: Date.now() },
    approvalResponse: null,
  });

  showApprovalBubble(tab.id);

  return new Promise((resolve) => {
    const timer = setTimeout(async () => {
      chrome.storage.onChanged.removeListener(listener);
      await chrome.storage.local.remove(['pendingApproval', 'approvalResponse']).catch(() => {});
      removeApprovalBubble(tab.id);
      resolve({ approved: false, timedOut: true, reason: 'No response after 60s — action was denied by timeout' });
    }, 60_000);

    function listener(changes, area) {
      if (area !== 'local' || !('approvalResponse' in changes)) return;
      const val = changes.approvalResponse.newValue;
      if (val === null || val === undefined) return;

      clearTimeout(timer);
      chrome.storage.onChanged.removeListener(listener);
      chrome.storage.local.remove(['pendingApproval', 'approvalResponse']).catch(() => {});
      removeApprovalBubble(tab.id);
      resolve({ approved: val === 'approved' });
    }

    chrome.storage.onChanged.addListener(listener);
  });
}

// ── Action history ─────────────────────────────────────────────────────────────

function describeAction(command, params, result) {
  switch (command) {
    case 'navigate_to':        return `Navigated → ${result?.title || params?.url || ''}`;
    case 'take_screenshot':    return `Screenshot — ${result?.title || ''}`;
    case 'click_element':      return `Clicked ${params?.selector || ''}`;
    case 'type_text':          return `Typed into ${params?.selector || ''}`;
    case 'get_page_context':   return `Read page — ${result?.title || result?.url || ''}`;
    case 'attach_debugger':    return 'Debugger attached';
    case 'detach_debugger':    return 'Debugger detached';
    case 'get_console_errors': return `Console errors (${result?.errors?.length ?? 0})`;
    case 'get_network_errors': return `Network errors (${result?.errors?.length ?? 0})`;
    case 'request_approval':   return result?.approved ? `✓ Approved — ${params?.action || ''}` : `✕ Denied — ${params?.action || ''}`;
    case 'toggle_mobile':      return result?.mobileEmulation ? 'Mobile emulation ON (iPhone 15 Pro)' : 'Mobile emulation OFF';
    default:                   return command;
  }
}

async function recordAction(command, params, result) {
  const entry = {
    id: Date.now() + Math.random(),
    command,
    label: describeAction(command, params, result),
    timestamp: Date.now(),
    hasScreenshot: command === 'take_screenshot' && !result?.error,
    url: result?.url || params?.url || null,
    error: result?.error || null,
  };
  // NOTE: chrome.storage.local is used (not session) because content scripts
  // injected via executeScript cannot read chrome.storage.session.
  const { actionHistory = [] } = await chrome.storage.local.get('actionHistory').catch(() => ({ actionHistory: [] }));
  actionHistory.push(entry);
  if (actionHistory.length > 40) actionHistory.splice(0, actionHistory.length - 40);
  await chrome.storage.local.set({ actionHistory }).catch(() => {});
}

// ── Keep service worker alive ──────────────────────────────────────────────────

chrome.alarms.create('keepAlive', { periodInMinutes: 0.4 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'keepAlive') {
    if (!ws || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
      connect();
    }
  }
});

// ── WebSocket connection ───────────────────────────────────────────────────────

function connect() {
  try {
    ws = new WebSocket(WS_URL);
  } catch (e) {
    setBadge('OFF', '#ef4444');
    return;
  }

  ws.onopen = () => {
    setBadge('ON', '#22c55e');
    // Clear sidebar history and any stale approval state on every new session
    chrome.storage.local.set({
      actionHistory: [],
      pendingApproval: null,
      approvalResponse: null,
      mobileEmulationActive: false,
    }).catch(() => {});
    // Forcefully remove any full-page ring overlay left in the active tab's DOM
    // (covers the case where old extension code had already injected it)
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs[0]) return;
      chrome.scripting.executeScript({
        target: { tabId: tabs[0].id },
        func: () => {
          document.getElementById('__closeloop_ring__')?.remove();
          document.getElementById('__closeloop_ring_style__')?.remove();
        },
      }).catch(() => {});
    });
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

  ws.onerror = () => ws.close();
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

// ── Command handler ────────────────────────────────────────────────────────────

async function handleCommand(msg) {
  // Inject ring + sidebar into the active tab on every command.
  // injectSidebar uses executeScript which works without a user gesture,
  // unlike chrome.sidePanel.open() which is silently blocked here.
  let activeTab = null;
  try {
    activeTab = await getActiveTab();
    showAgentRing(activeTab.id);
    injectSidebar(activeTab.id);
  } catch {}

  let result;
  try {
    switch (msg.command) {
      case 'get_page_context':   result = await getPageContext(); break;
      case 'take_screenshot':    result = await takeScreenshot(); break;
      case 'click_element':      result = await clickElement(msg.params); break;
      case 'type_text':          result = await typeText(msg.params); break;
      case 'attach_debugger':    result = await attachDebugger(); break;
      case 'detach_debugger':    result = await detachDebugger(); break;
      case 'get_console_errors': result = { errors: consoleErrors.splice(0) }; break;
      case 'get_network_errors': result = { errors: networkErrors.splice(0) }; break;
      case 'toggle_mobile':      result = await toggleMobile(msg.params); break;
      case 'request_approval':   result = await requestApproval(msg.params); break;

      case 'navigate_to':
        result = await navigateTo(msg.params);
        // Page DOM was replaced — re-inject ring and sidebar into the new page
        try {
          const newTab = await getActiveTab();
          showAgentRing(newTab.id);
          injectSidebar(newTab.id);
        } catch {}
        break;

      case 'clear_history':
        await chrome.storage.local.set({ actionHistory: [] }).catch(() => {});
        return { cleared: true };

      default: result = { error: `Unknown command: ${msg.command}` };
    }
  } catch (e) {
    result = { error: e.message };
  }

  await recordAction(msg.command, msg.params || {}, result);
  return result;
}

// ── Browser commands ───────────────────────────────────────────────────────────

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
  chrome.storage.local.set({
    lastScreenshot: dataUrl,
    lastScreenshotTime: Date.now(),
    lastScreenshotTitle: tab.title,
  });
  return { screenshot: dataUrl, url: tab.url, title: tab.title };
}

async function clickElement({ selector }) {
  const tab = await getActiveTab();

  // Highlight the target element so the user can see what's about to be clicked
  const elText = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: (sel) => {
      try {
        const el = document.querySelector(sel);
        return el ? (el.textContent?.trim().slice(0, 30) || el.getAttribute('aria-label') || '') : '';
      } catch { return ''; }
    },
    args: [selector],
  }).then(r => r[0]?.result || '').catch(() => '');

  const label = elText ? `↖ About to click — "${elText}"` : '↖ About to click';
  await highlightElement(tab.id, selector, label);
  await new Promise(r => setTimeout(r, 2000));

  // Flash green confirmation for 160ms so the user sees exactly when the click fires
  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => {
      const o = document.getElementById('__cl_pre_action__');
      const b = document.getElementById('__cl_pre_badge__');
      if (o) { o.style.animation = 'none'; o.style.borderColor = '#22c55e'; o.style.boxShadow = '0 0 0 4px #22c55e, 0 0 40px 16px #22c55e88'; }
      if (b) { b.style.background = '#22c55e'; const l = b.querySelector('div'); if (l) l.textContent = '✓ Clicking!'; }
    },
  }).catch(() => {});
  await new Promise(r => setTimeout(r, 250));

  const [result] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: (sel) => {
      document.getElementById('__cl_pre_action__')?.remove();
      document.getElementById('__cl_pre_badge__')?.remove();
      let el;
      try { el = document.querySelector(sel); } catch (e) {
        return { error: `Invalid selector: ${sel}` };
      }
      if (!el) return { error: `No element found for: ${sel}` };
      el.scrollIntoView({ block: 'center', behavior: 'instant' });
      el.click();
      return { clicked: sel, tag: el.tagName.toLowerCase(), text: el.textContent?.trim().slice(0, 60) };
    },
    args: [selector],
  });
  return result.result;
}

async function typeText({ selector, text, clear = true }) {
  const tab = await getActiveTab();

  // Highlight the target input so the user can see where text is about to go
  const preview = text.length > 24 ? text.slice(0, 24) + '…' : text;
  await highlightElement(tab.id, selector, `✎ About to type — "${preview}"`);
  await new Promise(r => setTimeout(r, 2000));

  // Flash blue confirmation for 160ms before typing
  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => {
      const o = document.getElementById('__cl_pre_action__');
      const b = document.getElementById('__cl_pre_badge__');
      if (o) { o.style.animation = 'none'; o.style.borderColor = '#38bdf8'; o.style.boxShadow = '0 0 0 4px #38bdf8, 0 0 40px 16px #38bdf888'; }
      if (b) { b.style.background = '#0ea5e9'; b.style.color = '#fff'; const l = b.querySelector('div'); if (l) l.textContent = '✎ Typing…'; }
    },
  }).catch(() => {});
  await new Promise(r => setTimeout(r, 250));

  const [result] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: (sel, txt, clr) => {
      document.getElementById('__cl_pre_action__')?.remove();
      document.getElementById('__cl_pre_badge__')?.remove();
      let el;
      try { el = document.querySelector(sel); } catch (e) {
        return { error: `Invalid selector: ${sel}` };
      }
      if (!el) return { error: `No element found for: ${sel}` };
      el.focus();
      const proto = el instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      const newVal = clr ? txt : (el.value + txt);
      if (nativeSetter) nativeSetter.call(el, newVal);
      else el.value = newVal;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return { typed: txt, into: sel, cleared: clr };
    },
    args: [selector, text, clear],
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
  // Persist so injected sidebar can always show the "being debugged" notice
  await chrome.storage.local.set({ debuggerActive: true });
  return { attached: true, tabId: tab.id, url: tab.url };
}

async function detachDebugger() {
  if (debuggingTabId) {
    try { await chrome.debugger.detach({ tabId: debuggingTabId }); } catch {}
    debuggingTabId = null;
  }
  await chrome.storage.local.set({ debuggerActive: false });
  return { detached: true };
}

// ── Mobile emulation (toggle Chrome DevTools responsive design mode) ───────────

// Preset: iPhone 15 Pro dimensions
const MOBILE_PRESET = { width: 393, height: 852, deviceScaleFactor: 3, mobile: true };

async function toggleMobile({ enable } = {}) {
  const tab = await getActiveTab();

  // Auto-attach debugger if needed
  if (debuggingTabId !== tab.id) {
    await attachDebugger();
  }

  const { mobileEmulationActive = false } = await chrome.storage.local.get('mobileEmulationActive').catch(() => ({}));
  const shouldEnable = enable !== undefined ? enable : !mobileEmulationActive;

  if (shouldEnable) {
    await chrome.debugger.sendCommand({ tabId: tab.id }, 'Emulation.setDeviceMetricsOverride', {
      width:             MOBILE_PRESET.width,
      height:            MOBILE_PRESET.height,
      deviceScaleFactor: MOBILE_PRESET.deviceScaleFactor,
      mobile:            MOBILE_PRESET.mobile,
      screenWidth:       MOBILE_PRESET.width,
      screenHeight:      MOBILE_PRESET.height,
    });
    await chrome.debugger.sendCommand({ tabId: tab.id }, 'Emulation.setUserAgentOverride', {
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    });
    await chrome.storage.local.set({ mobileEmulationActive: true });
    return { mobileEmulation: true, preset: 'iPhone 15 Pro (393×852)', tabId: tab.id };
  } else {
    await chrome.debugger.sendCommand({ tabId: tab.id }, 'Emulation.clearDeviceMetricsOverride');
    await chrome.debugger.sendCommand({ tabId: tab.id }, 'Emulation.setUserAgentOverride', { userAgent: '' });
    await chrome.storage.local.set({ mobileEmulationActive: false });
    return { mobileEmulation: false, tabId: tab.id };
  }
}

// ── Debugger event listener ────────────────────────────────────────────────────

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

// ── Cleanup on tab events ──────────────────────────────────────────────────────

function clearSessionState() {
  // Only clear action history and transient state — NOT debuggerActive,
  // which is managed exclusively by attachDebugger / detachDebugger.
  chrome.storage.local.set({
    actionHistory: [],
    pendingApproval: null,
    approvalResponse: null,
    mobileEmulationActive: false,
  }).catch(() => {});
}

chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === debuggingTabId) {
    debuggingTabId = null;
  }
  clearSessionState();
});

// Clear history whenever the user switches to a different tab
chrome.tabs.onActivated.addListener(() => {
  clearSessionState();
});

// Clear history whenever a new tab is created
chrome.tabs.onCreated.addListener(() => {
  clearSessionState();
});

connect();
