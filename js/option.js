const $ = (id) => document.getElementById(id);

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

  $("btn-save").addEventListener("click", () => {
    saveOptions(widthInput.value, heightInput.value, stateInput.value, openModeInput.value);
  });

  $("btn-reset").addEventListener("click", () => {
    widthInput.value = DEFAULT_WINDOW_SIZE.width;
    heightInput.value = DEFAULT_WINDOW_SIZE.height;
    applyState(DEFAULT_WINDOW_STATE);
    applyOpenMode(DEFAULT_OPEN_MODE);
    updateRatio(widthInput.value, heightInput.value);
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
