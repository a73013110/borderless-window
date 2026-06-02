# Borderless Window / 無邊框視窗

A lightweight Chrome extension (Manifest V3) that opens the current tab as a clean, borderless popup window — no toolbar, no address bar, no clutter.

一款輕量的 Chrome 擴充功能（Manifest V3），可將目前分頁以乾淨的**無邊框視窗**開啟 —— 沒有工具列、沒有網址列、沒有干擾。

<p align="center">
  <a href="https://chromewebstore.google.com/detail/oldkbmmdbndonbiogadbbbmgdkdpjoae">
    <img src="https://img.shields.io/chrome-web-store/v/oldkbmmdbndonbiogadbbbmgdkdpjoae?label=Chrome%20Web%20Store&logo=googlechrome&logoColor=white" alt="Chrome Web Store">
  </a>
  <a href="LICENSE">
    <img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License: MIT">
  </a>
</p>

> 🛒 **[Install from the Chrome Web Store / 從 Chrome 線上應用程式商店安裝](https://chromewebstore.google.com/detail/oldkbmmdbndonbiogadbbbmgdkdpjoae)**

---

## ✨ Features / 功能

- **Borderless popup** — open any page in a chromeless window.
  以無邊框視窗開啟任意網頁。
- **Four open modes / 四種開啟模式**
  - `Clone tab` 複製分頁 — keep the original, open a copy.
  - `Move tab` 搬移分頁 — move the current tab into the popup.
  - `Reopen (no history)` 另開（不帶歷史）— open a fresh window without tab history.
  - `Picture-in-Picture (Beta)` 子母畫面（Beta）— floating always-on-top view, with graceful fallback to a borderless window when unsupported.
- **Open in incognito / 無痕視窗開啟** — send a page or link straight to an incognito window.
- **Move back to main window / 搬回原視窗** — pull a popup tab back into a normal browser window in one click.
- **Right-click anywhere / 右鍵隨處可用** — works from the toolbar button, the page context menu, and link context menus.
- **Customizable / 可自訂** — default window size, window state (normal / maximized), and default open mode.
- **Bilingual UI / 中英雙語介面** — `zh_TW` and `en`.

Supported protocols: `http` / `https` / `file`.
支援的協定：`http` / `https` / `file`。

---

## 🚀 Installation / 安裝

### From the Chrome Web Store (recommended) / 從線上應用程式商店安裝（推薦）

Install in one click — no developer mode required.
一鍵安裝，免開啟開發者模式。

👉 **https://chromewebstore.google.com/detail/oldkbmmdbndonbiogadbbbmgdkdpjoae**

### From source (developer mode) / 從原始碼載入（開發者模式）

1. Download or clone this repository.
   下載或 clone 本儲存庫。
2. Open `chrome://extensions` in Chrome.
   在 Chrome 開啟 `chrome://extensions`。
3. Enable **Developer mode** (top-right).
   開啟右上角的**開發者模式**。
4. Click **Load unpacked** and select this project folder.
   點擊**載入未封裝項目**，選擇本專案資料夾。

---

## 🖱️ Usage / 使用方式

- **Toolbar button / 工具列按鈕**：click the icon to open the current tab using your default mode.
  點擊圖示，以預設模式開啟目前分頁。
- **Right-click menu / 右鍵選單**：choose a mode directly, open in incognito, or move a popup back to the main window.
  直接選擇模式、以無痕開啟，或把無邊框視窗搬回一般視窗。
- **Options page / 設定頁**：adjust window size, state, and default open mode.
  調整視窗大小、狀態與預設開啟模式。

---

## 🔐 Permissions / 權限說明

| Permission | Why it's needed / 用途 |
|------------|------------------------|
| `activeTab` | Read the current tab's URL to reopen it. 讀取目前分頁網址以重新開啟。 |
| `storage`   | Save your options. 儲存你的設定。 |
| `contextMenus` | Provide right-click actions. 提供右鍵選單功能。 |
| `notifications` | Show fallback / error notices. 顯示備援或錯誤提示。 |
| `scripting` | Inject the Picture-in-Picture helper. 注入子母畫面所需的腳本。 |

This extension does **not** collect, transmit, or store any browsing data externally.
本擴充功能**不會**蒐集、傳送或對外儲存任何瀏覽資料。

---

## 📦 Tech / 技術

- Manifest V3, vanilla JavaScript (no build step, no dependencies).
- Manifest V3、純 JavaScript（無打包流程、無相依套件）。

---

## 📄 License / 授權

[MIT](LICENSE) © Yikai
