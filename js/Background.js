importScripts("./common/constants.js", "./common/functions.js");

// ─── Context menu（僅在安裝/更新時註冊一次） ───
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    // 4 個開啟模式（對應 option 設定）；複製/搬移/PiP 需有當前分頁，連結右鍵時不顯示
    const NON_LINK_CONTEXTS = ["page", "frame", "selection", "editable", "image", "video", "audio", "action"];
    const modes = [
      [CONTEXT_MENU_CLONE_ID, "contextMenuModeClone", NON_LINK_CONTEXTS],
      [CONTEXT_MENU_MOVE_ID,  "contextMenuModeMove",  NON_LINK_CONTEXTS],
      [CONTEXT_MENU_NEW_ID,      "contextMenuModeNew",   ["all"]],
      [CONTEXT_MENU_PIP_ID,      "contextMenuClickPip",  NON_LINK_CONTEXTS],
      [CONTEXT_MENU_PIP_PICK_ID, "contextMenuPipPick",   NON_LINK_CONTEXTS]
    ];
    for (const [id, key, contexts] of modes) {
      chrome.contextMenus.create({ id, title: getMessage(key), contexts });
    }
    chrome.contextMenus.create({
      id: "newTabWindowMenuSep",
      type: "separator",
      contexts: ["all"]
    });
    chrome.contextMenus.create({
      id: CONTEXT_MENU_INCOGNITO_ID,
      title: getMessage("contextMenuClickIncognito"),
      contexts: ["all"]
    });
    chrome.contextMenus.create({
      id: SEP_RESTORE_ID,
      type: "separator",
      contexts: ["all"]
    });
    chrome.contextMenus.create({
      id: CONTEXT_MENU_RESTORE_ID,
      title: getMessage("contextMenuRestore"),
      contexts: ["all"],
      visible: false
    });
  });
});

// ─── 觸發來源：擴充功能按鈕 ───
chrome.action.onClicked.addListener((tab) => dispatchOpen(tab));

// ─── 觸發來源：右鍵選單 ───
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === CONTEXT_MENU_RESTORE_ID) {
    return restorePopupToNormalWindow(tab?.windowId);
  }
  // 連結右鍵：一律以 popup 開啟（PiP 需要既有分頁，連結場景不適用）
  if (info.linkUrl) {
    if (!isAllowedUrl(info.linkUrl)) return notify(getMessage("unsupport"));
    const incognito = info.menuItemId === CONTEXT_MENU_INCOGNITO_ID;
    return openPopup({ url: info.linkUrl, incognito });
  }
  // 頁面右鍵：依選單項目決定行為
  switch (info.menuItemId) {
    case CONTEXT_MENU_CLONE_ID:     return dispatchOpen(tab, { forceMode: "clone" });
    case CONTEXT_MENU_MOVE_ID:      return dispatchOpen(tab, { forceMode: "move" });
    case CONTEXT_MENU_NEW_ID:       return dispatchOpen(tab, { forceMode: "new" });
    case CONTEXT_MENU_PIP_ID:       return dispatchOpen(tab, { forceMode: "pip" });
    case CONTEXT_MENU_PIP_PICK_ID:  return tryEnterPip(tab, { mode: "picker" });
    case CONTEXT_MENU_INCOGNITO_ID: return dispatchOpen(tab, { incognito: true });
  }
});

// 依設定（openMode）分派：pip 走注入腳本；其餘走 popup（incognito 一律 popup）
const dispatchOpen = async (tab, { incognito = false, forceMode } = {}) => {
  if (!isAllowedUrl(tab?.url)) return notify(getMessage("unsupport"));
  if (incognito) return openPopup({ url: tab.url, incognito: true });
  const openMode = forceMode ?? (await getWindowOptions()).openMode;
  switch (openMode) {
    case "pip":
      return tryEnterPip(tab);
    case "new":
      return openPopup({ url: tab.url });
    case "clone": {
      const { id } = await chrome.tabs.duplicate(tab.id);
      return openPopup({ tabId: id });
    }
    case "move":
    default:
      return openPopup({ tabId: tab.id });
  }
};

// 注入 PiP 腳本；無法注入（chrome://、設定頁等）時 fallback 為 popup。
// mode "picker" 額外注入取景器，並在注入前把模式寫進頁面供 inject.js 讀取。
const tryEnterPip = async (tab, { mode = "body" } = {}) => {
  const target = { tabId: tab.id };
  try {
    if (mode === "picker") {
      await chrome.scripting.executeScript({
        target,
        func: (m) => { window.__NEWTAB_PIP_MODE = m; },
        args: ["picker"]
      });
    }
    await chrome.scripting.executeScript({
      target,
      files: mode === "picker"
        ? ["js/pip/picker.js", "js/pip/inject.js"]
        : ["js/pip/inject.js"]
    });
  } catch {
    notify(getMessage("pipInjectBlocked"));
    openPopup({ tabId: tab.id });
  }
};

// ─── PiP 注入腳本 ↔ SW 訊息中樞 ───
chrome.runtime.onMessage.addListener((msg, sender) => {
  const tabId = sender.tab?.id;
  switch (msg?.type) {
    case "notify":
      notify(getMessage(msg.key));
      return;
    case "pipFallback":
      if (tabId != null) openPopup({ tabId });
      notify(msg.error
        ? `${getMessage("pipUnsupported")}（${msg.error}）`
        : getMessage("pipUnsupported"));
      return;
    case "pipToPopup":
      if (tabId != null) openPopup({ tabId });
      return;
    case "pipOpenInNewTab":
      if (msg.url) chrome.tabs.create({ url: msg.url });
      return;
    case "pipResized": {
      const w = Number(msg.width), h = Number(msg.height);
      if (Number.isFinite(w) && w > 0 && Number.isFinite(h) && h > 0) {
        chrome.storage.sync.set({ pipWidth: String(w), pipHeight: String(h) });
      }
      return;
    }
  }
});

// ─── 視窗焦點變更時，切換「搬回原視窗」選單可見性 ───
chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) return;
  const visible = await isOurWindow(windowId);
  chrome.contextMenus.update(CONTEXT_MENU_RESTORE_ID, { visible });
});

// ─── 使用者調整視窗後寫回 storage.sync（normal 記錄尺寸、其他狀態僅記錄 state） ───
chrome.windows.onBoundsChanged.addListener(async (win) => {
  if (!(await isOurWindow(win.id))) return;
  if (!ALLOWED_WINDOW_STATES.includes(win.state)) return;
  const patch = { state: win.state };
  if (win.state === "normal") {
    patch.width = String(win.width);
    patch.height = String(win.height);
  }
  await chrome.storage.sync.set(patch);
});

// 視窗關閉時清除追蹤紀錄
chrome.windows.onRemoved.addListener((id) => {
  untrackWindow(id);
});

// 協定白名單檢查
const isAllowedUrl = (url) => {
  try { return ALLOWED_PROTOCOLS.includes(new URL(url).protocol); }
  catch { return false; }
};

// 開啟無邊框彈窗（payload: { url } 新開 URL | { tabId } 既有分頁；incognito 時一律以 url 開啟）
const openPopup = async ({ url, tabId, incognito = false }) => {
  const { width, height, state } = await getWindowOptions();
  const createOpts = {
    type: "popup",
    focused: true,
    state,
    ...(incognito
      ? { url, incognito: true }
      : (tabId != null ? { tabId } : { url }))
  };
  // state 為 maximized 時不可同時帶 width/height/left/top
  if (state === "normal") {
    const base = await chrome.windows.getCurrent();
    Object.assign(createOpts, {
      width,
      height,
      left: base.left + Math.round((base.width - width) / 2),
      top: base.top + Math.round((base.height - height) / 4)
    });
  }
  const win = await chrome.windows.create(createOpts);
  if (win) {
    await trackWindow(win.id);
    // 補救：windows.create 觸發的 onFocusChanged 早於 trackWindow 寫入，
    // 此時直接根據已知結果同步更新選單可見性
    chrome.contextMenus.update(CONTEXT_MENU_RESTORE_ID, { visible: true });
  }
};

// 將指定 popup 內的所有分頁搬回一般視窗（找不到則用第一個分頁開新視窗）
const restorePopupToNormalWindow = async (popupId) => {
  if (popupId == null || !(await isOurWindow(popupId))) return;
  const tabs = await chrome.tabs.query({ windowId: popupId });
  if (!tabs.length) return;
  const tabIds = tabs.map((t) => t.id);

  const normals = await chrome.windows.getAll({ windowTypes: ["normal"] });
  const target = normals.find((w) => !w.incognito) || normals[0];

  let targetId;
  if (target) {
    targetId = target.id;
    await chrome.tabs.move(tabIds, { windowId: targetId, index: -1 });
  } else {
    targetId = (await chrome.windows.create({ tabId: tabIds[0] })).id;
    if (tabIds.length > 1) {
      await chrome.tabs.move(tabIds.slice(1), { windowId: targetId, index: -1 });
    }
  }
  await chrome.tabs.update(tabIds[tabIds.length - 1], { active: true });
  await chrome.windows.update(targetId, { focused: true });
};

// 讀取使用者設定的視窗尺寸、狀態與開啟模式
const getWindowOptions = async () => {
  const opts = await chrome.storage.sync.get(STORAGE_DEFAULTS);
  const state = ALLOWED_WINDOW_STATES.includes(opts.state) ? opts.state : DEFAULT_WINDOW_STATE;
  const openMode = ALLOWED_OPEN_MODES.includes(opts.openMode) ? opts.openMode : DEFAULT_OPEN_MODE;
  return {
    width: Number(opts.width),
    height: Number(opts.height),
    state,
    openMode
  };
};

// ─── 追蹤本擴充功能建立的視窗（用 storage.session 避免 SW 重啟後遺失） ───
const trackWindow = async (id) => {
  const { [SESSION_KEY_OUR_WINDOWS]: ids = [] } =
    await chrome.storage.session.get(SESSION_KEY_OUR_WINDOWS);
  if (!ids.includes(id)) {
    ids.push(id);
    await chrome.storage.session.set({ [SESSION_KEY_OUR_WINDOWS]: ids });
  }
};

const untrackWindow = async (id) => {
  const { [SESSION_KEY_OUR_WINDOWS]: ids = [] } =
    await chrome.storage.session.get(SESSION_KEY_OUR_WINDOWS);
  const next = ids.filter((x) => x !== id);
  if (next.length !== ids.length) {
    await chrome.storage.session.set({ [SESSION_KEY_OUR_WINDOWS]: next });
  }
};

const isOurWindow = async (id) => {
  const { [SESSION_KEY_OUR_WINDOWS]: ids = [] } =
    await chrome.storage.session.get(SESSION_KEY_OUR_WINDOWS);
  return ids.includes(id);
};
