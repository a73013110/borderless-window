// 元素級 pop-out 的取景器（inspector picker）。
// 由 background 與 inject.js 一起注入；本檔載入時只掛上 namespace，不主動執行。
//
// 對外介面：
//   window.__NewtabPipPicker.start({ hint, accent }, onPick) → { cancel() }
//   - hover 即時高亮游標下元素；↑/↓ 沿 DOM 樹放大/縮小框選範圍；Esc 取消
//   - 使用者「點擊的當下」同步呼叫 onPick(element)，保住 PiP requestWindow 需要的 user gesture
//   - 選取後自動收尾；cancel() 供外部（再次觸發）強制收尾
//
// 設計重點：
//   - host 用罕見標籤名 + 全 inline !important + Shadow DOM，將站台 CSS 攻擊面降到最低
//   - host 設 pointer-events:none，讓 elementFromPoint 取得「頁面」元素而非 overlay 本身；
//     點擊則在 window capture 階段攔截，阻止頁面反應後才交出選取結果

(() => {
  "use strict";
  if (window.__NewtabPipPicker) return; // 重複注入保護

  const EASE_SPRING = "cubic-bezier(0.32, 0.72, 0, 1)";

  const HOST_STYLE = [
    "all: initial !important",
    "position: fixed !important",
    "inset: 0 !important",
    "z-index: 2147483647 !important",
    "pointer-events: none !important",
    "display: block !important"
  ].join("; ");

  const STYLES = (accent) => `
    :host { --accent: ${accent}; --ease: ${EASE_SPRING}; }

    /* 高亮框：超大 spread 的 box-shadow 形成「聚光燈」，框外自動變暗 */
    .spot {
      position: fixed;
      box-sizing: border-box;
      border: 2px solid var(--accent);
      border-radius: 6px;
      box-shadow:
        0 0 0 100vmax rgba(0, 0, 0, 0.45),
        0 0 14px rgba(255, 157, 61, 0.55),
        inset 0 0 0 1px rgba(255, 255, 255, 0.25);
      opacity: 0;
      pointer-events: none;
      transition:
        top 0.18s var(--ease), left 0.18s var(--ease),
        width 0.18s var(--ease), height 0.18s var(--ease),
        opacity 0.2s var(--ease);
    }
    .spot.ready { opacity: 1; }

    /* 提示膠囊：與 toolbar 同一套 vibrancy 毛玻璃材質 */
    .hint {
      position: fixed; top: 16px; left: 50%;
      transform: translateX(-50%);
      display: flex; align-items: center; gap: 9px;
      padding: 8px 14px;
      border-radius: 13px;
      background: rgba(30, 30, 32, 0.55);
      backdrop-filter: blur(24px) saturate(180%);
      -webkit-backdrop-filter: blur(24px) saturate(180%);
      border: 0.5px solid rgba(255, 255, 255, 0.14);
      box-shadow:
        0 8px 28px rgba(0, 0, 0, 0.36),
        inset 0 0.5px 0 rgba(255, 255, 255, 0.18);
      color: rgba(255, 255, 255, 0.92);
      font: 12.5px/1.4 -apple-system, system-ui, 'Segoe UI', sans-serif;
      white-space: nowrap;
      pointer-events: none;
      user-select: none;
    }
    .hint .dot {
      width: 7px; height: 7px; border-radius: 50%;
      background: var(--accent);
      box-shadow: 0 0 8px var(--accent);
      flex: none;
    }
    .hint .tag { opacity: 0.6; font-variant-numeric: tabular-nums; }

    @media (prefers-reduced-motion: reduce) {
      .spot { transition-duration: 0.01ms; }
    }
  `;

  function start({ hint = "", accent = "#ff9d3d", onClose } = {}, onPick) {
    const host = document.createElement("newtab-pip-picker");
    host.style.cssText = HOST_STYLE;
    const shadow = host.attachShadow({ mode: "closed" });
    shadow.innerHTML =
      `<style>${STYLES(accent)}</style>` +
      `<div class="spot"></div>` +
      `<div class="hint"><span class="dot"></span>` +
      `<span class="label"></span><span class="tag"></span></div>`;
    const spot = shadow.querySelector(".spot");
    shadow.querySelector(".label").textContent = hint;
    const tagEl = shadow.querySelector(".tag");
    document.documentElement.appendChild(host);

    let chain = [];     // 游標下葉節點 → 祖先鏈（[0]=葉，往上至 body）
    let level = 0;      // 沿鏈往上的層數（granularity，跨 mousemove 保持）
    let current = null; // 目前框選元素

    // 葉節點往上至 body 的祖先鏈（不含 <html>，避免框到整份文件）
    const ancestorsOf = (leaf) => {
      const list = [];
      for (let n = leaf; n && n !== document.documentElement; n = n.parentElement) {
        list.push(n);
      }
      return list;
    };

    const paint = () => {
      if (!current) { spot.classList.remove("ready"); return; }
      const r = current.getBoundingClientRect();
      spot.style.top = `${r.top}px`;
      spot.style.left = `${r.left}px`;
      spot.style.width = `${r.width}px`;
      spot.style.height = `${r.height}px`;
      spot.classList.add("ready");
      tagEl.textContent =
        `${current.tagName.toLowerCase()} · ${Math.round(r.width)}×${Math.round(r.height)}`;
    };

    const resolveFromChain = () => {
      current = chain.length ? chain[Math.min(level, chain.length - 1)] : null;
      paint();
    };

    const onMove = (e) => {
      const leaf = document.elementFromPoint(e.clientX, e.clientY);
      if (!leaf || leaf === chain[0]) return; // 同一葉節點 → 維持目前 granularity
      chain = ancestorsOf(leaf);
      resolveFromChain();
    };

    const onKey = (e) => {
      if (e.key === "Escape") { e.preventDefault(); stop(); return; }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        level = Math.min(level + 1, Math.max(0, chain.length - 1));
        resolveFromChain();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        level = Math.max(level - 1, 0);
        resolveFromChain();
      }
    };

    const reposition = () => paint();

    // 滑動過程阻斷站台對 mousedown/up 的反應，但不阻 click 本身的觸發
    const blockSilent = (e) => { e.preventDefault(); e.stopPropagation(); };

    // 點擊：阻止頁面反應，並於「點擊當下」同步交出選取元素（gesture 命脈）
    const onClick = (e) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      const picked = current;
      stop();
      if (picked && onPick) onPick(picked);
    };

    let stopped = false;
    const stop = () => {
      if (stopped) return;
      stopped = true;
      window.removeEventListener("mousemove", onMove, true);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("click", onClick, true);
      window.removeEventListener("mousedown", blockSilent, true);
      window.removeEventListener("mouseup", blockSilent, true);
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition, true);
      host.remove();
      if (onClose) onClose(); // 任何收尾路徑（Esc / cancel / 選取後）都通知外部清狀態
    };

    window.addEventListener("mousemove", onMove, true);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("click", onClick, true);
    window.addEventListener("mousedown", blockSilent, true);
    window.addEventListener("mouseup", blockSilent, true);
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition, true);

    return { cancel: stop };
  }

  window.__NewtabPipPicker = { start };
})();
