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
  const HEIGHT_COLLAPSED = "8px";
  const HEIGHT_EXPANDED = "58px";

  // Apple 風格 spring 緩動（sheet / 控制項常用），略帶過衝的細膩減速感
  const EASE_SPRING = "cubic-bezier(0.32, 0.72, 0, 1)";

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
    :host {
      --accent: #ff9d3d;
      --ease: ${EASE_SPRING};
      font-family: -apple-system, system-ui, 'Segoe UI', sans-serif;
    }

    /* 靜止指示器：置中的小握把（grabber），取代全寬細條 */
    .grabber {
      position: absolute; top: 3px; left: 50%;
      width: 34px; height: 4px;
      margin-left: -17px;
      border-radius: 4px;
      background: rgba(255, 255, 255, 0.32);
      box-shadow: 0 0 8px rgba(0, 0, 0, 0.25);
      pointer-events: none;
      transition: opacity 0.3s var(--ease), transform 0.3s var(--ease);
    }
    :host(.expanded) .grabber { opacity: 0; transform: translateY(-4px) scaleX(0.6); }

    /* 浮動容器：全寬置中，承載膠囊 */
    .dock {
      position: absolute; top: 8px; left: 0; right: 0;
      display: flex; justify-content: center;
      pointer-events: none;
    }

    /* 膠囊本體：vibrancy 毛玻璃材質 */
    .panel {
      display: flex; align-items: center; gap: 2px;
      padding: 5px 8px;
      border-radius: 16px;
      background: rgba(30, 30, 32, 0.55);
      backdrop-filter: blur(24px) saturate(180%);
      -webkit-backdrop-filter: blur(24px) saturate(180%);
      border: 0.5px solid rgba(255, 255, 255, 0.14);
      box-shadow:
        0 8px 28px rgba(0, 0, 0, 0.36),
        0 2px 8px rgba(0, 0, 0, 0.20),
        inset 0 0.5px 0 rgba(255, 255, 255, 0.18);
      color: rgba(255, 255, 255, 0.92);
      box-sizing: border-box;
      pointer-events: auto;
      user-select: none;
      opacity: 0;
      transform: translateY(-14px) scale(0.94);
      transition:
        opacity 0.28s var(--ease),
        transform 0.40s var(--ease);
    }
    :host(.expanded) .panel { opacity: 1; transform: translateY(0) scale(1); }

    /* 內容物錯位浮現（staggered reveal） */
    .panel > * {
      opacity: 0;
      transform: translateY(-6px);
      transition: opacity 0.26s var(--ease), transform 0.32s var(--ease);
    }
    :host(.expanded) .panel > * { opacity: 1; transform: none; }
    :host(.expanded) .panel > *:nth-child(1) { transition-delay: 0.05s; }
    :host(.expanded) .panel > *:nth-child(2) { transition-delay: 0.09s; }
    :host(.expanded) .panel > *:nth-child(3) { transition-delay: 0.13s; }
    :host(.expanded) .panel > *:nth-child(4) { transition-delay: 0.17s; }
    :host(.expanded) .panel > *:nth-child(5) { transition-delay: 0.21s; }

    .btn {
      all: unset;
      display: inline-flex; align-items: center; justify-content: center;
      width: 30px; height: 30px;
      border-radius: 9px;
      color: rgba(255, 255, 255, 0.82);
      cursor: pointer;
      transition:
        background 0.2s var(--ease),
        color 0.2s var(--ease),
        transform 0.18s var(--ease);
    }
    .btn:hover {
      background: rgba(255, 255, 255, 0.12);
      color: #fff;
      transform: scale(1.06);
    }
    .btn:active { transform: scale(0.9); }
    .btn svg { width: 15px; height: 15px; display: block; }
    .btn.dim-toggle:hover { color: var(--accent); }

    /* 分組分隔線 */
    .divider {
      width: 0.5px; height: 18px;
      margin: 0 5px;
      background: rgba(255, 255, 255, 0.16);
      flex: none;
    }

    /* 精緻 slider（Chrome only — 可放心用 -webkit 偽元素） */
    .slider {
      -webkit-appearance: none; appearance: none;
      width: 104px; height: 18px;
      margin: 0 4px 0 2px;
      background: transparent;
      cursor: pointer;
    }
    .slider::-webkit-slider-runnable-track {
      height: 4px; border-radius: 3px;
      background: linear-gradient(
        90deg,
        var(--accent) 0 var(--val, 100%),
        rgba(255, 255, 255, 0.20) var(--val, 100%) 100%
      );
    }
    .slider::-webkit-slider-thumb {
      -webkit-appearance: none; appearance: none;
      width: 13px; height: 13px;
      margin-top: -4.5px;
      border-radius: 50%;
      background: #fff;
      box-shadow:
        0 1px 4px rgba(0, 0, 0, 0.45),
        0 0 0 0.5px rgba(0, 0, 0, 0.12);
      transition: transform 0.16s var(--ease);
    }
    .slider:hover::-webkit-slider-thumb { transform: scale(1.18); }
    .slider:active::-webkit-slider-thumb { transform: scale(1.05); }

    @media (prefers-reduced-motion: reduce) {
      .grabber, .panel, .panel > *, .btn, .slider::-webkit-slider-thumb {
        transition-duration: 0.01ms !important;
      }
    }
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
    // 模式由 background 在注入前寫入頁面（picker = 元素級 pop-out）；讀取後即清除
    const mode = window.__NEWTAB_PIP_MODE;
    delete window.__NEWTAB_PIP_MODE;

    const prev = window[STATE_KEY];
    if (prev) { prev.dismiss(); return; } // 再次觸發 = 收起（涵蓋 pip / prompt / picker）

    if (!("documentPictureInPicture" in window)) {
      sendBg({ type: "pipFallback", error: "documentPictureInPicture unavailable" });
      return;
    }

    if (mode === "picker") return startPicker();

    const result = await openPip();
    if (result === "needs_gesture") showPrompt();
  })();

  // 嘗試開啟整頁 PiP — 回傳 "ok" | "needs_gesture" | "failed"
  async function openPip() {
    const size = await readPipSize();
    const content = await readContentSettings();
    let pip;
    try {
      pip = await documentPictureInPicture.requestWindow(size);
    } catch (e) {
      if (e?.name === "NotAllowedError") return "needs_gesture";
      console.warn("[PiP] requestWindow failed", e);
      sendBg({ type: "pipFallback", error: e?.message || String(e) });
      return "failed";
    }
    setupPip(pip, document.body, content);
    return "ok";
  }

  // ─── 元素級 pop-out（picker 模式） ─────────────────────────────────
  // gesture 命脈：尺寸/設定必須在進取景模式前讀好，點擊 handler 內不可再 await。
  async function startPicker() {
    if (!window.__NewtabPipPicker) {
      // picker.js 未一起注入時，退回整頁 PiP，至少不失能
      const result = await openPip();
      if (result === "needs_gesture") showPrompt();
      return;
    }
    const size = await readPipSize();
    const content = await readContentSettings();
    const handle = window.__NewtabPipPicker.start(
      {
        hint: i18n("pickerHint"),
        accent: "#ff9d3d",
        // 取景器任何收尾路徑（Esc / cancel / 選取）都清掉 picker 狀態，避免卡死後續觸發
        onClose: () => { if (window[STATE_KEY]?.kind === "picker") window[STATE_KEY] = null; }
      },
      (el) => openPipWithElement(el, size, content)
    );
    window[STATE_KEY] = { kind: "picker", dismiss: () => handle.cancel() };
  }

  // 於 picker 的點擊 handler 內「同步」呼叫 —— requestWindow 必須吃到這個 gesture
  function openPipWithElement(el, size, content) {
    window[STATE_KEY] = null; // picker 已收尾，交棒給 PiP（失敗時保持 null 以便重試）
    documentPictureInPicture.requestWindow(size)
      .then((pip) => setupPip(pip, el, content))
      .catch((e) => {
        console.warn("[PiP] requestWindow failed", e);
        sendBg({ type: "pipFallback", error: e?.message || String(e) });
      });
  }

  // ─── PiP setup（目標節點搬移 + toolbar 掛載 + resize 自動存檔） ──────
  // target 為整頁（document.body）或 picker 選中的元素；兩者共用同一套
  // placeholder 換位 → 搬入 PiP → 還原 的生命週期，差異僅在於掛載方式。
  function setupPip(pip, target, content) {
    const isBody = target === document.body;
    const parent = target.parentNode;
    const placeholder = document.createElement(isBody ? "body" : "div");
    let toolbarHost = null;
    let restored = false;

    // 必須早於任何 await：使用者可能在 setup 完成前就手動關閉 PiP
    const restore = () => {
      if (restored) return;
      restored = true;
      toolbarHost?.remove();
      if (placeholder.parentNode) placeholder.replaceWith(target);
      target.style.opacity = "";
      if (window[STATE_KEY]?.kind === "pip") window[STATE_KEY] = null;
    };
    pip.addEventListener("pagehide", restore, { once: true });
    pip.addEventListener("unload", restore, { once: true });

    window[STATE_KEY] = {
      kind: "pip",
      dismiss: () => { restore(); try { pip.close(); } catch {} }
    };

    try {
      cloneDocumentChrome(pip);

      // 搬移目標：placeholder 佔位於原頁面，目標節點接到 PiP
      parent.replaceChild(placeholder, target);
      if (isBody) {
        pip.document.body.replaceWith(target);  // 整頁：目標即成為 PiP 的 body
      } else {
        pip.document.body.style.margin = "0";
        pip.document.body.appendChild(target);  // 元素：掛進 PiP 預設 body 內
      }

      // html 背景：內容透過 opacity 變淡時，透出的就是這個顏色
      pip.document.documentElement.style.backgroundColor = content.bgColor;

      toolbarHost = createToolbar(pip, content, (action, value) =>
        handleAction({ pip, action, value, el: target })
      );
      (isBody ? target : pip.document.body).prepend(toolbarHost);
      target.style.opacity = String(content.opacity);

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

  // 複製 :root attributes、<head> 樣式節點與 <base> 到 PiP document
  function cloneDocumentChrome(pip) {
    // class、lang、style（CSS 變數常掛在 :root）
    for (const attr of document.documentElement.attributes) {
      pip.document.documentElement.setAttribute(attr.name, attr.value);
    }
    // 只複製「視覺所需」節點：<style> 與 stylesheet/icon/font 類 <link>。
    // 明確排除：
    //   - <script>（重跑時引用 stale DOM 會例外）
    //   - <meta http-equiv="Content-Security-Policy">：新版 Chrome 會在 PiP 視窗
    //     套用此 CSP，導致 SPA 搬進 PiP 後動態載入的 script chunk 違規被擋，
    //     進而連鎖觸發 renderer 被殺（RESULT_CODE_KILLED_BAD_MESSAGE）。
    //   - <link rel="preload"/"modulepreload"/"prefetch"/...>：會在 PiP 內觸發
    //     腳本/資源載入，同樣撞 CSP。
    for (const node of document.head.children) {
      if (!isStyleChrome(node)) continue;
      try { pip.document.head.appendChild(node.cloneNode(true)); } catch {}
    }
    // <base> 讓相對路徑（img src、a href、CSS url()）仍指向原 origin
    if (!pip.document.querySelector("base")) {
      const base = pip.document.createElement("base");
      base.href = location.href;
      pip.document.head.prepend(base);
    }
  }

  // 判斷某 <head> 節點是否為「純視覺」、可安全複製進 PiP 的樣式節點。
  // 白名單：<style>、<link rel=stylesheet|icon|...icon|preload as=style|font>。
  // 其餘（script、meta、CSP、preload/modulepreload script、prefetch…）一律排除。
  function isStyleChrome(node) {
    const tag = node.tagName;
    if (tag === "STYLE") return true;
    if (tag !== "LINK") return false;
    const rel = (node.getAttribute("rel") || "").toLowerCase();
    if (rel.includes("stylesheet")) return true;
    if (rel.includes("icon")) return true;
    // 只放行明確是樣式/字型的 preload，擋掉 as=script / fetch / document 等
    if (rel === "preload") {
      const as = (node.getAttribute("as") || "").toLowerCase();
      return as === "style" || as === "font";
    }
    return false;
  }

  // Toolbar 按鈕分派
  function handleAction({ pip, action, value, el }) {
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
        el.style.opacity = String(value);
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
      `; transition: height 0.4s ${EASE_SPRING} !important`;

    const shadow = host.attachShadow({ mode: "closed" });
    shadow.innerHTML =
      `<style>${TOOLBAR_STYLES}</style>` +
      `<div class="grabber"></div>` +
      `<div class="dock"><div class="panel"></div></div>`;
    const panel = shadow.querySelector(".panel");

    for (const { i18n: key, icon, action } of TOOLBAR_BUTTONS) {
      panel.appendChild(makeButton(doc, key, icon, () => onAction(action)));
    }

    const divider = doc.createElement("span");
    divider.className = "divider";
    panel.appendChild(divider);

    // 內容變淡控制：左側按鈕循環切換背景色（白 ↔ 黑），右側 slider 控制 opacity
    let bgIdx = Math.max(0, BG_PRESETS.indexOf(bgColor));
    const dimToggle = makeButton(doc, "pipBgToggleLabel", "opacity", () => {
      bgIdx = (bgIdx + 1) % BG_PRESETS.length;
      onAction("bg", BG_PRESETS[bgIdx]);
    });
    dimToggle.classList.add("dim-toggle");
    panel.appendChild(dimToggle);

    // 內容透明度 slider（自帶軌道填色與拖曳狀態）
    const { el: slider, isDragging } = makeSlider(doc, opacity, (v) => onAction("opacity", v));
    panel.appendChild(slider);

    let collapseTimer;
    const setExpanded = (on) => {
      clearTimeout(collapseTimer);
      host.style.setProperty("height", on ? HEIGHT_EXPANDED : HEIGHT_COLLAPSED, "important");
      host.classList.toggle("expanded", on);
    };
    const tryCollapse = () => {
      if (isDragging()) {
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

  // 內容透明度 slider：建立元素、軌道填色與拖曳狀態於一處。
  // 回傳 { el, isDragging }；isDragging 供 toolbar 判斷拖曳中不可折回。
  function makeSlider(doc, opacity, onInput) {
    const slider = doc.createElement("input");
    slider.type = "range";
    slider.className = "slider";
    slider.min = String(OPACITY_MIN);
    slider.max = String(OPACITY_MAX);
    slider.step = String(OPACITY_STEP);
    slider.value = String(opacity);
    slider.title = i18n("pipOpacityLabel");

    // 軌道填色：把目前值映射成百分比寫進 --val
    const syncFill = (v) => {
      const pct = ((v - OPACITY_MIN) / (OPACITY_MAX - OPACITY_MIN)) * 100;
      slider.style.setProperty("--val", `${pct}%`);
    };
    syncFill(opacity);
    slider.addEventListener("input", () => {
      const v = Number(slider.value);
      syncFill(v);
      onInput(v);
    });

    // 拖曳 slider 時指標可能滑出 host 範圍，需延後折回直到拖曳結束
    let dragging = false;
    slider.addEventListener("pointerdown", (e) => {
      dragging = true;
      e.target.setPointerCapture?.(e.pointerId);
    });
    const stop = () => { dragging = false; };
    slider.addEventListener("pointerup", stop);
    slider.addEventListener("pointercancel", stop);
    slider.addEventListener("lostpointercapture", stop);

    return { el: slider, isDragging: () => dragging };
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
