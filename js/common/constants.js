// 共用常數
const DEFAULT_WINDOW_SIZE = { width: 1280, height: 747 };
const DEFAULT_WINDOW_STATE = "normal"; // normal | maximized
const ALLOWED_WINDOW_STATES = ["normal", "maximized"];
const DEFAULT_OPEN_MODE = "clone"; // new | move | clone | pip
const ALLOWED_OPEN_MODES = ["new", "move", "clone", "pip"];
const ALLOWED_PROTOCOLS = ["http:", "https:", "file:"];
const CONTEXT_MENU_CLONE_ID = "newTabWindowMenuItemClone";
const CONTEXT_MENU_MOVE_ID = "newTabWindowMenuItemMove";
const CONTEXT_MENU_NEW_ID = "newTabWindowMenuItemNew";
const CONTEXT_MENU_PIP_ID = "newTabWindowMenuItemPip";
const CONTEXT_MENU_PIP_PICK_ID = "newTabWindowMenuItemPipPick";
const CONTEXT_MENU_INCOGNITO_ID = "newTabWindowMenuItemIncognito";
const CONTEXT_MENU_RESTORE_ID = "newTabWindowMenuItemRestore";
const SEP_RESTORE_ID = "newTabWindowMenuSepRestore";
const STORAGE_DEFAULTS = {
  width: String(DEFAULT_WINDOW_SIZE.width),
  height: String(DEFAULT_WINDOW_SIZE.height),
  state: DEFAULT_WINDOW_STATE,
  openMode: DEFAULT_OPEN_MODE
};
// session 儲存：本擴充功能建立的 windowId 清單
const SESSION_KEY_OUR_WINDOWS = "ourWindowIds";
// session 儲存：目前開著 PiP 的 tabId（老闆鍵快捷鍵要打到正確分頁）
const SESSION_KEY_PIP_TAB = "pipTabId";

// ─── 老闆鍵（PiP panic 遮罩） ───
// 全存在 storage.local：圖片可能上看數百 KB，storage.sync 單項僅 8KB 放不下。
const PANIC_PRESETS = ["code", "sheet", "inbox", "custom"];
const DEFAULT_PANIC_PRESET = "code";
const BOSS_KEY_DEFAULTS = {
  pipBossKeyEnabled: true,
  pipPanicPreset: DEFAULT_PANIC_PRESET, // code | sheet | inbox | custom
  pipPanicMute: true,                   // 觸發時是否靜音 PiP 內影音
  pipPanicImage: ""                     // preset = custom 時的壓縮後 data URL
};
// 老闆鍵快捷鍵的 command 名稱（manifest commands）
const COMMAND_TOGGLE_PANIC = "toggle-panic";
