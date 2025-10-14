/* ui.js - Shared UI behaviors: theme, clock, tabs, modals, ripple, toasts, drag-drop helpers */

// THEME MANAGER -----------------------------------------------------------
const Theme = (() => {
  const KEY = "theme";
  let current = localStorage.getItem(KEY) || "dark";
  const apply = () =>
    document.documentElement.setAttribute("data-theme", current);
  const toggle = () => {
    current = current === "dark" ? "light" : "dark";
    localStorage.setItem(KEY, current);
    apply();
    dispatch();
  };
  const onChangeHandlers = new Set();
  const onChange = (fn) => {
    onChangeHandlers.add(fn);
    return () => onChangeHandlers.delete(fn);
  };
  const dispatch = () =>
    onChangeHandlers.forEach((fn) => {
      try {
        fn(current);
      } catch (e) {}
    });
  function init() {
    apply();
    document.addEventListener("keydown", (e) => {
      if (e.altKey && (e.key === "d" || e.key === "D")) {
        toggle();
      }
    });
  }
  return { init, toggle, onChange, get: () => current };
})();

// CLOCK -------------------------------------------------------------------
function initClock(selector = ".clock") {
  const el = document.querySelector(selector);
  if (!el) return;
  const update = () => {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    el.textContent = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(
      d.getSeconds()
    )}`;
  };
  update();
  setInterval(update, 1000);
}

// RIPPLE EFFECT -----------------------------------------------------------
function enableRipples(selector = ".btn") {
  document.addEventListener(
    "click",
    (e) => {
      const target = e.target.closest(selector);
      if (!target) return;
      const rect = target.getBoundingClientRect();
      const ripple = document.createElement("span");
      ripple.className = "ripple-effect";
      const size = Math.max(rect.width, rect.height);
      ripple.style.width = ripple.style.height = size + "px";
      ripple.style.left = e.clientX - rect.left - size / 2 + "px";
      ripple.style.top = e.clientY - rect.top - size / 2 + "px";
      target.appendChild(ripple);
      setTimeout(() => ripple.remove(), 600);
    },
    { passive: true }
  );
}

// TOASTS ------------------------------------------------------------------
const Toasts = (() => {
  let container;
  function ensure() {
    if (!container) {
      container = document.createElement("div");
      container.className = "toast-container";
      document.body.appendChild(container);
    }
  }
  function show(
    message,
    { title = null, type = null, timeout = 4000, actions = null } = {}
  ) {
    ensure();
    const el = document.createElement("div");
    el.className = "toast" + (type ? ` ${type}` : "");
    el.innerHTML = `<div style="flex:1;min-width:0"><div class="title">${
      title || ""
    }</div><div class="message">${message}</div></div>`;
    if (actions) {
      const wrap = document.createElement("div");
      wrap.style.display = "flex";
      wrap.style.gap = "6px";
      actions.forEach((a) => {
        const b = document.createElement("button");
        b.className = "btn btn-small btn-outline";
        b.textContent = a.label;
        b.addEventListener("click", () => {
          try {
            a.onClick && a.onClick();
          } finally {
            el.remove();
          }
        });
        wrap.appendChild(b);
      });
      el.appendChild(wrap);
    }
    const close = document.createElement("button");
    close.className = "btn btn-ghost btn-small";
    close.style.marginLeft = "4px";
    close.textContent = "×";
    close.setAttribute("aria-label", "Đóng");
    close.onclick = () => el.remove();
    el.appendChild(close);
    container.appendChild(el);
    if (timeout > 0) {
      setTimeout(() => el.remove(), timeout);
    }
    return el;
  }
  function success(msg, opts = {}) {
    return show(msg, {
      type: "success",
      title: opts.title || "Thành công",
      ...opts,
    });
  }
  function error(msg, opts = {}) {
    return show(msg, { type: "error", title: opts.title || "Lỗi", ...opts });
  }
  return { show, success, error };
})();

// MODAL MANAGER -----------------------------------------------------------
const Modal = (() => {
  function open(
    html,
    { onClose = null, closable = true, className = "" } = {}
  ) {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    const modal = document.createElement("div");
    modal.className = "modal " + className;
    modal.innerHTML = html;
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    const close = () => {
      overlay.remove();
      onClose && onClose();
      document.removeEventListener("keydown", esc);
    };
    function esc(e) {
      if (e.key === "Escape") close();
    }
    document.addEventListener("keydown", esc);
    if (closable) {
      const btn = document.createElement("button");
      btn.className = "close-btn";
      btn.innerHTML = "✕";
      btn.type = "button";
      btn.addEventListener("click", close);
      modal.appendChild(btn);
    }
    return { close, overlay, modal };
  }
  return { open };
})();

// TABS --------------------------------------------------------------------
function initTabs(root = document) {
  const tablists = [...root.querySelectorAll("[data-tabs]")];
  tablists.forEach((list) => {
    const buttons = [...list.querySelectorAll('[role="tab"]')];
    const panelIds = buttons.map((b) => b.getAttribute("data-target"));
    const panels = panelIds
      .map((id) => document.getElementById(id))
      .filter(Boolean);
    function activate(btn) {
      buttons.forEach((b) => {
        const sel = b === btn;
        b.setAttribute("aria-selected", sel);
        b.tabIndex = sel ? 0 : -1;
      });
      panels.forEach((p) => {
        p.classList.toggle("active", p.id === btn.getAttribute("data-target"));
      });
    }
    +buttons.forEach((b) => b.addEventListener("click", () => activate(b)));
    if (buttons.length) activate(buttons[0]);
  });
}

// DRAG & DROP HELPERS -----------------------------------------------------
function initDragDrop() {
  document.querySelectorAll(".drop-zone").forEach((zone) => {
    ["dragenter", "dragover"].forEach((ev) =>
      zone.addEventListener(ev, (e) => {
        e.preventDefault();
        zone.classList.add("drag-over");
      })
    );
    ["dragleave", "drop"].forEach((ev) =>
      zone.addEventListener(ev, (e) => {
        e.preventDefault();
        zone.classList.remove("drag-over");
      })
    );
    zone.addEventListener("drop", (e) => {
      const files = [...e.dataTransfer.files];
      zone.dispatchEvent(new CustomEvent("files-dropped", { detail: files }));
    });
  });
}

// PROGRESS BAR API --------------------------------------------------------
function updateProgress(selector, percent) {
  const bar = document.querySelector(selector);
  if (!bar) return;
  bar.style.width = Math.max(0, Math.min(100, percent)) + "%";
}

// ACCESSIBILITY -----------------------------------------------------------
function focusTrap(container) {
  const FOCUSABLE =
    'a,button,input,select,textarea,[tabindex]:not([tabindex="-1"])';
  const nodes = [...container.querySelectorAll(FOCUSABLE)].filter(
    (n) => !n.disabled && n.offsetParent !== null
  );
  if (!nodes.length) return;
  function key(e) {
    if (e.key !== "Tab") return;
    const first = nodes[0],
      last = nodes[nodes.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }
  container.addEventListener("keydown", key);
  return () => container.removeEventListener("keydown", key);
}

// INIT --------------------------------------------------------------------
function initUI() {
  Theme.init();
  enableRipples();
  initClock();
  initTabs();
  initDragDrop(); // sample keyboard shortcuts
  document.addEventListener("keydown", (e) => {
    if (e.altKey && (e.key === "t" || e.key === "T")) {
      Toasts.show("Shortcut Alt+T triggered", { title: "Shortcut" });
    }
  });
}

document.addEventListener("DOMContentLoaded", initUI);

// EXPORTS (ESM friendly) --------------------------------------------------
export {
  Theme,
  Toasts,
  Modal,
  enableRipples,
  initTabs,
  updateProgress,
  focusTrap,
};
