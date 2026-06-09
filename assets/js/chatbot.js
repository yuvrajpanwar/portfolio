
(function () {
  'use strict';

  // ── DOM refs ──────────────────────────────────────────────
  const fab         = document.getElementById('uv-fab');
  const chatWindow  = document.getElementById('uv-chat-window');
  const closeBtn    = document.getElementById('uv-close-btn');
  const refreshBtn  = document.getElementById('uv-refresh-btn');
  const confirmBar  = document.getElementById('uv-confirm-bar');
  const confirmYes  = document.getElementById('uv-confirm-yes');
  const confirmNo   = document.getElementById('uv-confirm-no');
  const messagesEl  = document.getElementById('uv-messages');
  const inputEl     = document.getElementById('uv-input');
  const sendBtn     = document.getElementById('uv-send-btn');
  const typingRow   = document.getElementById('uv-typing-row');

  // ── Config ────────────────────────────────────────────────
  const ENDPOINT         = 'https://dailyorbit.in/chatbot/message';
  const HISTORY_ENDPOINT = 'https://dailyorbit.in/chatbot/history';
  const RESET_ENDPOINT   = 'https://dailyorbit.in/chatbot/reset';
  const AI_AVATAR        = "assets/img/uv.jpg";
  const GREETING = "Heyy! I'm UV 😎\nAsk me anything about my work, projects, or experience.";
  const CSRF_TOKEN       = document.querySelector('meta[name="csrf-token"]')?.content ?? '';

  // ── State ─────────────────────────────────────────────────
  let isOpen        = false;
  let isWaiting     = false;
  let greetingDone  = false;
  let confirmActive = false;
  let sessionToken  = localStorage.getItem('uv_chat_session') ?? null;

  // ── Helpers ───────────────────────────────────────────────
  function getTime() {
    return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function formatTime(isoString) {
    if (!isoString) return getTime();
    try {
      return new Date(isoString).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch {
      return getTime();
    }
  }

  function scrollToBottom(instant = false) {
    messagesEl.appendChild(typingRow);
    if (instant) {
      messagesEl.style.scrollBehavior = 'auto';
      messagesEl.scrollTop = messagesEl.scrollHeight;
      messagesEl.style.scrollBehavior = '';
    } else {
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }
  }

  /**
   * @param {'ai'|'user'} who
   * @param {string} text   — may contain HTML (links from server)
   * @param {string} time   — formatted time string
   * @param {boolean} restored — if true, use fade-in instead of bounce
   */
  function appendMessage(who, text, time = null, restored = false) {
    const row = document.createElement('div');
    row.className = `uv-msg-row uv-${who}${restored ? ' uv-restored' : ''}`;

    const avatarHTML = who === 'ai'
      ? `<img class="uv-row-avatar" src="${AI_AVATAR}" alt="UV" />`
      : '';

    const displayTime = time ?? getTime();

    // Server replies may contain anchor tags — render as HTML.
    // User messages are plain text — escape to prevent XSS.
    const contentHTML = who === 'user'
      ? escapeHTML(text).replace(/\n/g, '<br>')
      : text.replace(/\n/g, '<br>');

    row.innerHTML = `
      ${avatarHTML}
      <div class="uv-bubble">
        ${contentHTML}
        <span class="uv-bubble-time">${displayTime}</span>
      </div>
    `;

    messagesEl.insertBefore(row, typingRow);
    scrollToBottom(restored);
  }

  function escapeHTML(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function showTyping() {
    typingRow.classList.add('uv-visible');
    scrollToBottom();
  }

  function hideTyping() {
    typingRow.classList.remove('uv-visible');
  }

  function setWaiting(state) {
    isWaiting        = state;
    sendBtn.disabled = state;
    inputEl.disabled = state;
  }

  function insertDivider(label) {
    const div = document.createElement('div');
    div.className = 'uv-history-divider uv-restored';
    div.innerHTML = `<span>${label}</span>`;
    messagesEl.insertBefore(div, typingRow);
  }

  // ── Confirm bar ───────────────────────────────────────────
  function showConfirm() {
    confirmActive = true;
    confirmBar.classList.add('uv-visible');
  }

  function hideConfirm() {
    confirmActive = false;
    confirmBar.classList.remove('uv-visible');
  }

  // ── History restore ───────────────────────────────────────
 async function restoreHistory() {
  if (!sessionToken) {
    // No session yet → nothing to restore
    return;
  }

  try {
    const res = await fetch(HISTORY_ENDPOINT, {
      headers: {
        'Accept':           'application/json',
        'X-Requested-With': 'XMLHttpRequest',
        'X-Chat-Session':   sessionToken,        // ← THIS WAS MISSING
      }
    });

    if (!res.ok) return;

    const data = await res.json();
    const messages = data.messages ?? [];

    if (messages.length === 0) return;

    greetingDone = true;
    insertDivider('Previous conversation');

    messages.forEach(msg => {
      const who = msg.role === 'assistant' ? 'ai' : 'user';
      appendMessage(who, msg.content, formatTime(msg.sent_at), true);
    });

  } catch (err) {
    console.warn('[UV Chatbot] History restore failed:', err);
  }
}

  // ── Reset session ─────────────────────────────────────────
  async function resetSession() {
    hideConfirm();
    setWaiting(true);

    try {
      await fetch(RESET_ENDPOINT, {
          method:  'POST',
          headers: {
              'Content-Type':     'application/json',
              'Accept':           'application/json',
              'X-Requested-With': 'XMLHttpRequest',
              'X-Chat-Session':   sessionToken ?? '',   // ← add this
          },
          // credentials: 'same-origin',   ← remove this line
      });

      // ← add these two lines after the fetch (before UI clear)
      sessionToken = null;
      localStorage.removeItem('uv_chat_session');
    } catch (err) {
      console.warn('[UV Chatbot] Reset request failed:', err);
    }

    // Clear UI regardless of server response
    // Remove all message rows (keep typing row)
    [...messagesEl.querySelectorAll('.uv-msg-row, .uv-history-divider')].forEach(el => el.remove());

    greetingDone = false;
    setWaiting(false);

    // Show fresh greeting
    greetingDone = true;
    setTimeout(() => appendMessage('ai', GREETING), 200);

    inputEl.focus();
  }

  // ── Open / Close ──────────────────────────────────────────
  function openChat() {
    if (isOpen) return;
    isOpen = true;
    chatWindow.classList.add('uv-open');
    inputEl.focus();

    if (!greetingDone) {
      greetingDone = true;
      setTimeout(() => appendMessage('ai', GREETING), 350);
    }
  }

  function closeChat() {
    if (!isOpen) return;
    isOpen = false;
    chatWindow.classList.remove('uv-open');
    hideConfirm();
  }

  // ── Send message ──────────────────────────────────────────
  async function sendMessage() {
    const text = inputEl.value.trim();
    if (!text || isWaiting) return;

    if (confirmActive) hideConfirm();

    inputEl.value = '';
    sendBtn.disabled = true;

    appendMessage('user', text);
    setWaiting(true);
    showTyping();

    try {
      const response = await fetch(ENDPOINT, {
          method:  'POST',
          headers: {
              'Content-Type':     'application/json',
              'Accept':           'application/json',
              'X-Requested-With': 'XMLHttpRequest',
              'X-Chat-Session':   sessionToken ?? '',   // ← add this
          },
          // credentials: 'same-origin',   ← remove this line
          body: JSON.stringify({ message: text }),
      });

      const data = await response.json();

      // ← add this block
      if (data.session_token) {
          sessionToken = data.session_token;
          localStorage.setItem('uv_chat_session', sessionToken);
      }
      hideTyping();

      if (!response.ok) {
        appendMessage('ai', data.reply ?? 'Something went wrong. Please try again.');
        return;
      }

      appendMessage('ai', data.reply ?? "I didn't catch that. Could you try again?");

    } catch (err) {
      hideTyping();
      appendMessage('ai', 'Network error. Please check your connection and try again.');
      console.error('[UV Chatbot]', err);
    } finally {
      setWaiting(false);
    }
  }

  // ── Event Listeners ───────────────────────────────────────
  fab.addEventListener('click', openChat);
  closeBtn.addEventListener('click', closeChat);

  refreshBtn.addEventListener('click', () => {
    if (confirmActive) {
      hideConfirm();
    } else {
      showConfirm();
    }
  });

  confirmYes.addEventListener('click', resetSession);
  confirmNo.addEventListener('click', hideConfirm);

  sendBtn.addEventListener('click', sendMessage);

  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  inputEl.addEventListener('focus', () => {
    // Small delay lets the keyboard finish opening
    setTimeout(() => {
      inputEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      syncToViewport();
      scrollToBottom(true);
    }, 320);
  });

  inputEl.addEventListener('input', () => {
    sendBtn.disabled = inputEl.value.trim().length === 0 || isWaiting;
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (confirmActive) { hideConfirm(); return; }
      if (isOpen) closeChat();
    }
  });

  // ── On page load: restore history ────────────────────────
  document.addEventListener('DOMContentLoaded', () => {
    restoreHistory();
  });

  // ── Visual Viewport resize handler (mobile keyboard fix) ──
  function syncToViewport() {
    if (window.innerWidth > 480) return; // desktop: do nothing
    const vv = window.visualViewport;
    if (!vv) return;

    // The viewport shifts up by the keyboard height.
    // We clamp the window to match the visual viewport size.
    chatWindow.style.height = vv.height + 'px';
    chatWindow.style.top    = vv.offsetTop + 'px';
    chatWindow.style.bottom = 'auto';
  }

  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', syncToViewport);
    window.visualViewport.addEventListener('scroll', syncToViewport);
  }

  // Also reset when keyboard closes / orientation changes
  window.addEventListener('resize', () => {
    if (window.innerWidth > 480) {
      chatWindow.style.height = '';
      chatWindow.style.top    = '';
      chatWindow.style.bottom = '';
    }
  });

})();