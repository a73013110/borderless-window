const $ = (id) => document.getElementById(id);

// segmented on/off ↔ boolean（避免各處重複 ? "on" : "off" 與 !== "off" 的方向錯誤）
const toSeg = (b) => (b ? "on" : "off");
const fromSeg = (v) => v !== "off";

/* ──────────────────────────────────────────────────────────
   i18n — 預設依瀏覽器語言，亦可從頁面手動切換（方便測試）
   chrome.i18n.getMessage 無法在執行期改語言，故手動切換時
   直接 fetch 對應 _locales/<locale>/messages.json
   ────────────────────────────────────────────────────────── */
const SUPPORTED_LOCALES = ["en", "zh_TW"];
const LANG_STORAGE_KEY = "uiLang";          // "auto" | "en" | "zh_TW"

let i18nMessages = {};                        // 目前語言的訊息表
let i18nFallback = {};                         // en 後備訊息表

const t = (key) =>
  i18nMessages[key]?.message ?? i18nFallback[key]?.message ?? "";

const fetchLocaleMessages = async (locale) => {
  try {
    const url = chrome.runtime.getURL(`_locales/${locale}/messages.json`);
    const res = await fetch(url);
    return await res.json();
  } catch {
    return {};
  }
};

const resolveLocale = (pref) => {
  if (pref && pref !== "auto" && SUPPORTED_LOCALES.includes(pref)) return pref;
  const ui = (chrome.i18n.getUILanguage?.() || "en").toLowerCase();
  return ui.startsWith("zh") ? "zh_TW" : "en";
};

const applyI18n = () => {
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const msg = t(el.dataset.i18n);
    if (msg) el.textContent = msg;
  });
  document.querySelectorAll("[data-i18n-html]").forEach((el) => {
    const msg = t(el.dataset.i18nHtml);
    if (msg) el.innerHTML = msg;            // 來源為自家 locale 檔，非使用者輸入
  });
  const title = t("optTitle");
  if (title) document.title = title;
  document.documentElement.lang = t("htmlLang") || "zh-TW";
};

const loadAndApplyI18n = async (pref) => {
  const locale = resolveLocale(pref);
  i18nFallback = locale === "en" ? {} : await fetchLocaleMessages("en");
  i18nMessages = await fetchLocaleMessages(locale);
  applyI18n();
};

const gcd = (a, b) => (b === 0 ? a : gcd(b, a % b));

const formatRatio = (w, h) => {
  w = Math.round(Number(w)); h = Math.round(Number(h));
  if (!w || !h) return "— : —";
  const d = gcd(w, h);
  return `${w / d} : ${h / d}`;
};

const updateRatio = (w, h) => {
  const tag = $("ratio-badge");
  if (tag) tag.textContent = formatRatio(w, h);
};

const setupSegmented = (groupEl, hiddenInput) => {
  const buttons = [...groupEl.querySelectorAll(".seg")];
  const apply = (value) => {
    buttons.forEach((b) => b.classList.toggle("is-active", b.dataset.value === value));
    hiddenInput.value = value;
  };
  buttons.forEach((b) => {
    b.addEventListener("click", () => {
      apply(b.dataset.value);
      hiddenInput.dispatchEvent(new Event("change", { bubbles: true }));
    });
  });
  return apply;
};

window.addEventListener("DOMContentLoaded", async () => {
  // 語言：先讀偏好套用，再綁定切換事件
  const langSelect = $("select-lang");
  const { [LANG_STORAGE_KEY]: storedLang } = await chrome.storage.local.get(LANG_STORAGE_KEY);
  if (langSelect) langSelect.value = storedLang || "auto";
  await loadAndApplyI18n(storedLang);
  if (langSelect) {
    langSelect.addEventListener("change", async () => {
      await chrome.storage.local.set({ [LANG_STORAGE_KEY]: langSelect.value });
      await loadAndApplyI18n(langSelect.value);
    });
  }

  const versionEl = $("ext-version");
  if (versionEl) versionEl.textContent = `v${chrome.runtime.getManifest().version}`;

  const widthInput = $("input-width");
  const heightInput = $("input-height");
  const stateInput = $("input-state");
  const openModeInput = $("input-open-mode");

  const stateGroup = document.querySelector('.segmented[data-target="input-state"]');
  const openModeGroup = document.querySelector('.segmented[data-target="input-open-mode"]');
  const applyState = setupSegmented(stateGroup, stateInput);
  const applyOpenMode = setupSegmented(openModeGroup, openModeInput);

  // ─── 老闆鍵設定 ───
  const bossEnabledInput = $("input-bosskey-enabled");
  const panicPresetInput = $("input-panic-preset");
  const panicMuteInput = $("input-panic-mute");
  const applyBossEnabled = setupSegmented(
    document.querySelector('.segmented[data-target="input-bosskey-enabled"]'), bossEnabledInput);
  const applyPanicPreset = setupSegmented(
    document.querySelector('.segmented[data-target="input-panic-preset"]'), panicPresetInput);
  const applyPanicMute = setupSegmented(
    document.querySelector('.segmented[data-target="input-panic-mute"]'), panicMuteInput);

  const imageRow = $("panic-image-row");
  const preview = $("panic-preview");
  const fileInput = $("panic-file");
  // 目前選定的自訂圖（壓縮後 data URL）；存於記憶體，按「儲存」才寫入 storage.local
  let panicImageData = "";

  const setPreview = (dataUrl) => {
    panicImageData = dataUrl || "";
    if (panicImageData) {
      preview.style.backgroundImage = `url("${panicImageData}")`;
      preview.classList.add("has-image");
    } else {
      preview.style.backgroundImage = "";
      preview.classList.remove("has-image");
    }
  };
  const refreshImageRow = () => {
    imageRow.hidden = panicPresetInput.value !== "custom";
  };
  // 偽裝畫面切到/離開 custom 時，顯示/隱藏圖片上傳區
  panicPresetInput.addEventListener("change", refreshImageRow);

  fileInput.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    try {
      setPreview(await compressImage(file));
    } catch {
      notify(t("optPanicImageError") || "Image load failed");
    }
    fileInput.value = ""; // 允許重新選同一檔
  });
  $("panic-clear").addEventListener("click", () => setPreview(""));

  // 開啟 Chrome 快捷鍵設定頁（無法用 <a> 直連 chrome://，改用 tabs.create）
  $("open-shortcuts").addEventListener("click", () => {
    chrome.tabs.create({ url: "chrome://extensions/shortcuts" });
  });

  // 預覽空狀態文案（attr 給 CSS ::after 用）
  preview.dataset.emptyLabel = t("optPanicNoImage") || "No image";

  const onDimChange = () => updateRatio(widthInput.value, heightInput.value);
  widthInput.addEventListener("input", onDimChange);
  heightInput.addEventListener("input", onDimChange);

  document.querySelectorAll(".preset").forEach((btn) => {
    btn.addEventListener("click", () => {
      let w, h;
      if (btn.dataset.screen) {
        w = window.screen.availWidth  || window.screen.width;
        h = window.screen.availHeight || window.screen.height;
      } else {
        w = Number(btn.dataset.w);
        h = Number(btn.dataset.h);
      }
      widthInput.value = w;
      heightInput.value = h;
      updateRatio(w, h);
    });
  });

  restoreOptions(widthInput, heightInput, applyState, applyOpenMode);
  restoreBossKey({ applyBossEnabled, applyPanicPreset, applyPanicMute, setPreview, refreshImageRow });

  const collectBossKey = () => ({
    pipBossKeyEnabled: fromSeg(bossEnabledInput.value),
    pipPanicPreset: PANIC_PRESETS.includes(panicPresetInput.value) ? panicPresetInput.value : DEFAULT_PANIC_PRESET,
    pipPanicMute: fromSeg(panicMuteInput.value),
    pipPanicImage: panicImageData
  });

  $("btn-save").addEventListener("click", async () => {
    await chrome.storage.local.set(collectBossKey());
    saveOptions(widthInput.value, heightInput.value, stateInput.value, openModeInput.value);
  });

  $("btn-reset").addEventListener("click", async () => {
    widthInput.value = DEFAULT_WINDOW_SIZE.width;
    heightInput.value = DEFAULT_WINDOW_SIZE.height;
    applyState(DEFAULT_WINDOW_STATE);
    applyOpenMode(DEFAULT_OPEN_MODE);
    updateRatio(widthInput.value, heightInput.value);
    // 老闆鍵：寫回預設後，用同一條 restore 路徑重繪 UI（避免兩處套用邏輯漂移）
    await chrome.storage.local.set({ ...BOSS_KEY_DEFAULTS });
    await restoreBossKey({ applyBossEnabled, applyPanicPreset, applyPanicMute, setPreview, refreshImageRow });
    saveOptions(DEFAULT_WINDOW_SIZE.width, DEFAULT_WINDOW_SIZE.height, DEFAULT_WINDOW_STATE, DEFAULT_OPEN_MODE);
  });

  // background 在使用者拖動視窗後會自動更新 storage，這裡同步反映到輸入框
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync") return;
    if (changes.width)    widthInput.value = changes.width.newValue;
    if (changes.height)   heightInput.value = changes.height.newValue;
    if (changes.state)    applyState(changes.state.newValue);
    if (changes.openMode) applyOpenMode(changes.openMode.newValue);
    updateRatio(widthInput.value, heightInput.value);
  });
});

const restoreOptions = async (widthInput, heightInput, applyState, applyOpenMode) => {
  const stored = await chrome.storage.sync.get(STORAGE_DEFAULTS);
  widthInput.value = stored.width;
  heightInput.value = stored.height;
  applyState(stored.state);
  applyOpenMode(stored.openMode);
  updateRatio(stored.width, stored.height);
};

const saveOptions = async (width, height, state, openMode) => {
  await chrome.storage.sync.set({
    width: String(width),
    height: String(height),
    state,
    openMode
  });
  notify(getMessage("optionSaved"));
};

// 老闆鍵設定存於 storage.local（圖片過大，sync 放不下）
const restoreBossKey = async ({ applyBossEnabled, applyPanicPreset, applyPanicMute, setPreview, refreshImageRow }) => {
  const s = await chrome.storage.local.get(BOSS_KEY_DEFAULTS);
  applyBossEnabled(toSeg(s.pipBossKeyEnabled !== false));
  applyPanicPreset(PANIC_PRESETS.includes(s.pipPanicPreset) ? s.pipPanicPreset : DEFAULT_PANIC_PRESET);
  applyPanicMute(toSeg(s.pipPanicMute !== false));
  setPreview(typeof s.pipPanicImage === "string" ? s.pipPanicImage : "");
  refreshImageRow();
};

// 上傳圖壓縮：最長邊縮到 MAX、輸出 JPEG，控制 storage.local 佔用與套用速度
const PANIC_IMAGE_MAX_EDGE = 1600;
const PANIC_IMAGE_QUALITY = 0.85;
const compressImage = (file) =>
  new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, PANIC_IMAGE_MAX_EDGE / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, w, h);
      try {
        resolve(canvas.toDataURL("image/jpeg", PANIC_IMAGE_QUALITY));
      } catch (e) {
        reject(e);
      }
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("decode failed")); };
    img.src = url;
  });
