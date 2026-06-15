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
