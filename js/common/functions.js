/**
 * 取得 i18n 文字
 * @param {string} key _locales 中的 message key
 * @param {string|string[]} [substitutions] 對應訊息中的 $1, $2... 佔位符
 */
const getMessage = (key, substitutions) => chrome.i18n.getMessage(key, substitutions);

/**
 * 顯示系統通知
 * @param {string} message 通知內容
 */
const notify = (message) => {
  chrome.notifications.create({
    type: "basic",
    iconUrl: chrome.runtime.getURL("images/icon128.png"),
    title: getMessage("name"),
    message
  });
};
