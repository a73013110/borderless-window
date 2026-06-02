const $ = (id) => document.getElementById(id);

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

window.addEventListener("DOMContentLoaded", () => {
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
