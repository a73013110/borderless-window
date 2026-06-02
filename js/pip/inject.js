// 注入到目標分頁（isolated world）。透過 chrome.scripting.executeScript 重複觸發實現 toggle。
//
// 流程：
//   1. 若上次注入的狀態還在（PiP 開著、或浮窗顯示中）→ 關閉它，結束。
//   2. 從 storage 讀使用者設定的 PiP 尺寸 → requestWindow()。
//      右鍵選單路徑通常仍保留 user activation，能直接成功。
//   3. 失敗於 NotAllowedError → 顯示頁面浮窗，等使用者點一下取得 gesture 再開。
//
// Toolbar 設計：
//   - 完全包在 Shadow DOM，外殼用罕見標籤名 <newtab-pip-toolbar>，定位樣式 inline !important，
//     將站台 CSS 攻擊面降到最低（曾遇過站台規則把 toolbar 撐成全屏）
//   - 靜止狀態僅露 4px 細條；hover 頂部 → 展開為完整工具列；mouseleave → 自動折回
//
// 內容變淡（opacity）原理：
//   `body { opacity }` 讓 body 半透明，後面透出的是 `html` 的背景。網站 body 通常自帶背景色，
//   所以淡到一定程度才看得到 html 背景。提供 bg 切換是為了讓使用者控制變淡時融入的色調。

(() => {
  "use strict";

  // ─── Constants ────────────────────────────────────────────────────
  const DEFAULT_PIP_SIZE = { width: 720, height: 540 };
  const STATE_KEY = "__pipState";
  const RESIZE_DEBOUNCE_MS = 400;
  const COLLAPSE_DELAY_MS = 250;
  const SLIDER_DRAG_RETRY_MS = 200;
  const HEIGHT_COLLAPSED = "6px";
  const HEIGHT_EXPANDED = "32px";

  const OPACITY_MIN = 0.05;
  const OPACITY_MAX = 1;
  const OPACITY_STEP = 0.05;
  const DEFAULT_OPACITY = 1;

  // 內容變淡時融入的背景色，按按鈕循環切換
  const BG_PRESETS = ["#ffffff", "#000000"];
  const DEFAULT_BG = BG_PRESETS[0];

  const ICONS = {
    newTab:  '<svg viewBox="0 0 16 16"><path d="M9 2 H14 V7 M14 2 L8 8 M14 9 V14 H2 V2 H7" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    popup:   '<svg viewBox="0 0 16 16"><rect x="2" y="3" width="12" height="10" rx="1.2" stroke="currentColor" stroke-width="1.4" fill="none"/><path d="M2 6 H14" stroke="currentColor" stroke-width="1.4" fill="none"/></svg>',
    opacity: '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="5.5" stroke="currentColor" stroke-width="1.4" fill="none"/><path d="M8 2.5 a5.5 5.5 0 0 1 0 11 Z" fill="currentColor"/></svg>'
  };

  const TOOLBAR_BUTTONS = [
    { i18n: "pipBtnOpenNewTab", icon: "newTab", action: "openInNewTab" },
    { i18n: "pipBtnToPopup",    icon: "popup",  action: "toPopup" }
  ];

  // 外殼定位用 inline !important — 與站台 CSS 競爭時務必勝出
  const HOST_STYLE = [
    "all: initial !important",
    "position: fixed !important",
    "z-index: 2147483647 !important",
    "pointer-events: auto !important",
    "display: block !important"
  ].join("; ");

  const TOOLBAR_STYLES = `
    :host { font-family: system-ui, -apple-system, 'Segoe UI', sans-serif; }
    .strip {
      position: absolute; top: 0; left: 0; right: 0;
      height: 4px;
      background: linear-gradient(90deg, transparent, rgba(255, 157, 61, 0.32) 50%, transparent);
      opacity: 0.7;
      pointer-events: none;
      transition: opacity 0.18s ease;
    }
    .bar {
      position: absolute; top: 0; left: 0; right: 0;
      display: flex; align-items: center; gap: 4px;
      padding: 5px 8px;
      background: rgba(20, 20, 18, 0.55);
      backdrop-filter: blur(12px) saturate(140%);
      -webkit-backdrop-filter: blur(12px) saturate(140%);
      color: #f3e8d0;
      font-size: 12px;
      box-sizing: border-box;
      transform: translateY(-100%);
      transition: transform 0.18s ease;
      user-select: none;
    }
    .btn {
      all: unset;
      display: inline-flex; align-items: center; justify-content: center;
      width: 22px; height: 22px;
      border-radius: 4px;
      color: inherit;
      cursor: pointer;
      opacity: 0.78;
      transition: opacity 0.12s, background 0.12s, color 0.12s;
    }
    .btn:hover { opacity: 1; background: rgba(255, 157, 61, 0.18); color: #ff9d3d; }
    .btn:active { transform: translateY(1px); }
    .btn svg { width: 13px; height: 13px; display: block; }
    .btn.dim-toggle { margin-left: 4px; }
    .slider {
      -webkit-appearance: none; appearance: none;
      width: 96px; height: 4px;
      border-radius: 2px;
      background: rgba(243, 232, 208, 0.22);
      cursor: pointer;
      margin-left: 2px;
    }
    .slider::-webkit-slider-thumb {
      -webkit-appearance: none; appearance: none;
      width: 10px; height: 10px;
      border-radius: 50%;
      background: #ff9d3d;
      cursor: pointer;
    }
    :host(.expanded) .bar { transform: translateY(0); }
    :host(.expanded) .strip { opacity: 0; }
  `;

  const PROMPT_STYLES = `
    .wrap {
      display: flex; align-items: center; gap: 12px;
      padding: 10px 12px;
      border-radius: 6px;
      background: rgba(20, 20, 18, 0.95);
      color: #f3e8d0;
      border: 1px solid rgba(255, 157, 61, 0.4);
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
      font: 13px system-ui, -apple-system, 'Segoe UI', sans-serif;
      cursor: pointer;
      user-select: none;
    }
    .dismiss { opacity: 0.55; padding: 0 2px; }
  `;

  // ─── Helpers ──────────────────────────────────────────────────────
  const i18n = (key) => chrome.i18n.getMessage(key) || key;
  const sendBg = (msg) => chrome.runtime.sendMessage(msg).catch(() => {});
  const debounce = (fn, delay) => {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), delay); };
  };

  // chrome.storage 在被頁面 storage proxy 卡住時可能不回 — 加 timeout 兜底
  async function storageGet(area, keys) {
    return Promise.race([
      chrome.storage[area].get(keys).catch(() => ({})),
      new Promise((r) => setTimeout(() => r({}), 500))
    ]);
  }

  async function readPipSize() {
    const opts = await storageGet("sync", ["pipWidth", "pipHeight", "width", "height"]);
    const positive = (v) => {
      const n = Number(v);
      return Number.isFinite(n) && n > 0 ? n : null;
    };
    return {
      width:  positive(opts.pipWidth)  ?? positive(opts.width)  ?? DEFAULT_PIP_SIZE.width,
      height: positive(opts.pipHeight) ?? positive(opts.height) ?? DEFAULT_PIP_SIZE.height
    };
  }

  async function readContentSettings() {
    const opts = await storageGet("local", ["pipOpacity", "pipBgColor"]);
    return {
      opacity: typeof opts.pipOpacity === "number" ? opts.pipOpacity : DEFAULT_OPACITY,
      bgColor: typeof opts.pipBgColor === "string" ? opts.pipBgColor : DEFAULT_BG
    };
  }

  // ─── Entry ────────────────────────────────────────────────────────
  (async () => {
    const prev = window[STATE_KEY];
    if (prev) { prev.dismiss(); return; }

    if (!("documentPictureInPicture" in window)) {
      sendBg({ type: "pipFallback", error: "documentPictureInPicture unavailable" });
      return;
    }

    const result = await openPip();
    if (result === "needs_gesture") showPrompt();
  })();

  // 嘗試開啟 PiP — 回傳 "ok" | "needs_gesture" | "failed"
  async function openPip() {
    const size = await readPipSize();
    let pip;
    try {
      pip = await documentPictureInPicture.requestWindow(size);
    } catch (e) {
      if (e?.name === "NotAllowedError") return "needs_gesture";
      console.warn("[PiP] requestWindow failed", e);
      sendBg({ type: "pipFallback", error: e?.message || String(e) });
      return "failed";
    }
    setupPip(pip);
    return "ok";
  }

  // ─── PiP setup（body 搬移 + toolbar 掛載 + resize 自動存檔） ────────
  async function setupPip(pip) {
    const originalBody = document.body;
    const placeholder = document.createElement("body");
    let toolbarHost = null;
    let restored = false;

    // 必須早於任何 await：使用者可能在 setup 完成前就手動關閉 PiP
    const restore = () => {
      if (restored) return;
      restored = true;
      toolbarHost?.remove();
      if (placeholder.parentNode) placeholder.replaceWith(originalBody);
      originalBody.style.opacity = "";
      if (window[STATE_KEY]?.kind === "pip") window[STATE_KEY] = null;
    };
    pip.addEventListener("pagehide", restore, { once: true });
    pip.addEventListener("unload", restore, { once: true });

    window[STATE_KEY] = {
      kind: "pip",
      dismiss: () => { restore(); try { pip.close(); } catch {} }
    };

    try {
      const { opacity, bgColor } = await readContentSettings();
      cloneDocumentChrome(pip);

      // 搬移 body：placeholder 佔位於原頁面，真 body 接到 PiP
      document.documentElement.replaceChild(placeholder, originalBody);
      pip.document.body.replaceWith(originalBody);

      // html 背景：內容透過 body opacity 變淡時，透出的就是這個顏色
      pip.document.documentElement.style.backgroundColor = bgColor;

      toolbarHost = createToolbar(pip, { opacity, bgColor }, (action, value) =>
        handleAction({ pip, action, value, body: originalBody })
      );
      originalBody.prepend(toolbarHost);
      originalBody.style.opacity = String(opacity);

      // PiP 視窗大小調整 → 自動寫回 storage.sync（debounce 避免拖曳中狂寫）
      pip.addEventListener("resize", debounce(() => {
        sendBg({ type: "pipResized", width: pip.innerWidth, height: pip.innerHeight });
      }, RESIZE_DEBOUNCE_MS));
    } catch (e) {
      console.error("[PiP] setup failed", e);
      sendBg({ type: "notify", key: "pipInjectBlocked" });
      try { pip.close(); } catch {}
    }
  }

  // 複製 :root attributes、<head>（除 <script>）與 <base> 到 PiP document
  function cloneDocumentChrome(pip) {
    // class、lang、style（CSS 變數常掛在 :root）
    for (const attr of document.documentElement.attributes) {
      pip.document.documentElement.setAttribute(attr.name, attr.value);
    }
    // <head> 除 <script>（避免重跑時對 stale DOM 引用造成例外）
    for (const node of document.head.children) {
      if (node.tagName === "SCRIPT") continue;
      try { pip.document.head.appendChild(node.cloneNode(true)); } catch {}
    }
    // <base> 讓相對路徑（img src、a href、CSS url()）仍指向原 origin
    if (!pip.document.querySelector("base")) {
      const base = pip.document.createElement("base");
      base.href = location.href;
      pip.document.head.prepend(base);
    }
  }

  // Toolbar 按鈕分派
  function handleAction({ pip, action, value, body }) {
    switch (action) {
      case "openInNewTab":
        sendBg({ type: "pipOpenInNewTab", url: location.href });
        pip.close();
        return;
      case "toPopup":
        sendBg({ type: "pipToPopup" });
        pip.close();
        return;
      case "opacity":
        body.style.opacity = String(value);
        chrome.storage.local.set({ pipOpacity: value });
        return;
      case "bg":
        pip.document.documentElement.style.backgroundColor = value;
        chrome.storage.local.set({ pipBgColor: value });
        return;
    }
  }

  // ─── Toolbar（Shadow DOM 隔離 + hover 展開） ──────────────────────
  function createToolbar(pip, { opacity, bgColor }, onAction) {
    const doc = pip.document;
    const host = doc.createElement("newtab-pip-toolbar");
    host.style.cssText = HOST_STYLE +
      `; top: 0 !important; left: 0 !important; right: 0 !important` +
      `; height: ${HEIGHT_COLLAPSED} !important` +
      `; transition: height 0.18s ease !important`;

    const shadow = host.attachShadow({ mode: "closed" });
    shadow.innerHTML =
      `<style>${TOOLBAR_STYLES}</style><div class="strip"></div><div class="bar"></div>`;
    const bar = shadow.querySelector(".bar");

    for (const { i18n: key, icon, action } of TOOLBAR_BUTTONS) {
      bar.appendChild(makeButton(doc, key, icon, () => onAction(action)));
    }

    // 內容變淡控制：左側按鈕循環切換背景色（白 ↔ 黑），右側 slider 控制 opacity
    let bgIdx = Math.max(0, BG_PRESETS.indexOf(bgColor));
    const dimToggle = makeButton(doc, "pipBgToggleLabel", "opacity", () => {
      bgIdx = (bgIdx + 1) % BG_PRESETS.length;
      onAction("bg", BG_PRESETS[bgIdx]);
    });
    dimToggle.classList.add("dim-toggle");
    bar.appendChild(dimToggle);

    const slider = doc.createElement("input");
    slider.type = "range";
    slider.className = "slider";
    slider.min = String(OPACITY_MIN);
    slider.max = String(OPACITY_MAX);
    slider.step = String(OPACITY_STEP);
    slider.value = String(opacity);
    slider.title = i18n("pipOpacityLabel");
    slider.addEventListener("input", () => onAction("opacity", Number(slider.value)));
    bar.appendChild(slider);

    // 拖曳 slider 時可能滑出 host 範圍，需延後折回直到拖曳結束
    let sliderDragging = false;
    slider.addEventListener("pointerdown", (e) => {
      sliderDragging = true;
      e.target.setPointerCapture?.(e.pointerId);
    });
    const stopDrag = () => { sliderDragging = false; };
    slider.addEventListener("pointerup", stopDrag);
    slider.addEventListener("pointercancel", stopDrag);
    slider.addEventListener("lostpointercapture", stopDrag);

    let collapseTimer;
    const setExpanded = (on) => {
      clearTimeout(collapseTimer);
      host.style.setProperty("height", on ? HEIGHT_EXPANDED : HEIGHT_COLLAPSED, "important");
      host.classList.toggle("expanded", on);
    };
    const tryCollapse = () => {
      if (sliderDragging) {
        collapseTimer = setTimeout(tryCollapse, SLIDER_DRAG_RETRY_MS);
        return;
      }
      setExpanded(false);
    };
    host.addEventListener("mouseenter", () => setExpanded(true));
    host.addEventListener("mouseleave", () => {
      clearTimeout(collapseTimer);
      collapseTimer = setTimeout(tryCollapse, COLLAPSE_DELAY_MS);
    });

    return host;
  }

  function makeButton(doc, i18nKey, iconKey, onClick) {
    const label = i18n(i18nKey);
    const btn = doc.createElement("button");
    btn.type = "button";
    btn.className = "btn";
    btn.title = label;
    btn.setAttribute("aria-label", label);
    btn.innerHTML = ICONS[iconKey];
    btn.addEventListener("click", onClick);
    return btn;
  }

  // ─── Prompt（無 user activation 時的點擊提示） ───────────────────
  function showPrompt() {
    const host = document.createElement("newtab-pip-prompt");
    host.style.cssText = HOST_STYLE + `; top: 16px !important; right: 16px !important`;

    const shadow = host.attachShadow({ mode: "closed" });
    shadow.innerHTML = `<style>${PROMPT_STYLES}</style>
      <div class="wrap">
        <span class="label"></span>
        <span class="dismiss" role="button" aria-label="dismiss">✕</span>
      </div>`;
    shadow.querySelector(".label").textContent = i18n("pipClickToStart");
    document.documentElement.appendChild(host);

    const dismiss = () => {
      clearTimeout(timer);
      host.remove();
      if (window[STATE_KEY]?.kind === "prompt") window[STATE_KEY] = null;
    };
    const timer = setTimeout(dismiss, 10000);
    window[STATE_KEY] = { kind: "prompt", dismiss };

    shadow.querySelector(".dismiss").addEventListener("click", (e) => {
      e.stopPropagation();
      dismiss();
    });
    shadow.querySelector(".wrap").addEventListener("click", () => {
      dismiss();
      openPip();
    });
  }
})();
