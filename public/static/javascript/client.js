
(() => {
    // ============================================================
    // Config
    // ============================================================
    const SOCKET_URL = ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname)
        ? `ws://${window.location.hostname === "::1" ? "[::1]" : window.location.hostname}:3736`
        : "wss://message.antakim.uk";
    const MAX_MESSAGE_BYTES = 4096;
    const STORAGE_USERNAME_KEY = "uassapp-username";
    const IDB_NAME = "uassapp";
    const IDB_VERSION = 2;

    // ============================================================
    // DOM
    // ============================================================
    const $ = (id) => document.getElementById(id);
    const app = $("app");
    const contactsEl = $("contacts");
    const messagesEl = $("messages");
    const input = $("messageInput");
    const messageCounter = $("messageCounter");
    const sendButton = $("sendButton");
    const usernameInput = $("username");
    const usernameConfirm = $("usernameConfirm");
    const usernameStatus = $("usernameStatus");
    const appPopup = $("appPopup");
    const popupTitle = $("popupTitle");
    const popupMessage = $("popupMessage");
    const popupContinue = $("popupContinue");
    const popupClose = $("popupClose");
    const popupConfirmActions = $("popupConfirmActions");
    const popupCancel = $("popupCancel");
    const popupConfirm = $("popupConfirm");
    const statusDot = $("statusDot");
    const statusText = $("statusText");
    const activeName = $("activeName");
    const activeAvatar = $("activeAvatar");
    const activeSubtitle = $("activeSubtitle");
    const searchInput = $("search");
    const onlineSummary = $("onlineSummary");
    const settingsScreen = $("settingsScreen");
    const themeSelect = $("themeSelect");
    const generalBackgroundMode = $("generalBackgroundMode");
    const solidBackgroundColor = $("solidBackgroundColor");
    const interfacePalette = $("interfacePalette");
    const fontSelect = $("fontSelect");
    const enterToSend = $("enterToSend");
    const autoFocus = $("autoFocus");
    const accountStatusAlerts = $("accountStatusAlerts");
    const keyChangeAlerts = $("keyChangeAlerts");
    const appearanceDialog = $("appearanceDialog");
    const chatMenuButton = $("chatMenuButton");
    const chatMenu = $("chatMenu");
    const blockChatMenuItem = $("blockChatMenuItem");
    const profileDisplayName = $("profileDisplayName");
    const profileBio = $("profileBio");
    const profileAvatar = $("profileAvatar");
    const profilePassword = $("profilePassword");
    const chatBackgroundFile = $("chatBackgroundFile");
    const backgroundFit = $("backgroundFit");
    const backgroundRepeat = $("backgroundRepeat");
    const backgroundZoom = $("backgroundZoom");
    const backgroundZoomValue = $("backgroundZoomValue");
    const customCropControls = $("customCropControls");
    const cropX = $("cropX");
    const cropY = $("cropY");
    const receivedBubbleColor = $("receivedBubbleColor");
    const sentBubbleColor = $("sentBubbleColor");
    const messageFontColor = $("messageFontColor");

    // ============================================================
    // Estado
    // ============================================================
    const contactMap = new Map();
    const blockedUsernames = new Set();
    let activeId = null;
    let socket = null;
    let identity = null;
    let registeredUsername = null;
    let reconnectTimer = null;
    let presenceTimer = null;
    let pendingContactId = null;
    let retryDelay = 1000;
    let intentionalClose = false;
    let accountDeleted = false;
    let popupConfirmationResolver = null;
    let pendingContactListRequestId = null;
    let contactListUpdateTimer = null;
    const pendingContactLookups = new Map();
    const CHAT_APPEARANCE_KEY = "uassapp-chat-appearance";
    function getBooleanPreference(key, defaultValue = true) {
        try {
            const value = localStorage.getItem(key);
            return value === null ? defaultValue : value === "true";
        } catch {
            return defaultValue;
        }
    }
    let chatAppearances = (() => { try { return JSON.parse(localStorage.getItem(CHAT_APPEARANCE_KEY) || "{}"); } catch { return {}; } })();
    accountStatusAlerts.checked = getBooleanPreference("uassapp-account-status-alerts");
    keyChangeAlerts.checked = getBooleanPreference("uassapp-key-change-alerts");

    function saveChatAppearances() {
        try { localStorage.setItem(CHAT_APPEARANCE_KEY, JSON.stringify(chatAppearances)); }
        catch { showUsernameStatus("Could not save chat appearance — image may be too large"); }
    }
    function dismissUserDeletedAlert() {
        if (!appPopup.classList.contains("user-deleted-popup")) return;
        if (appPopup.open) appPopup.close();
        appPopup.classList.remove("user-deleted-popup");
    }
    function getChatAppearance(id = activeId) {
        return id ? (chatAppearances[id] || {}) : {};
    }
    function applyChatAppearance() {
        const appearance = getChatAppearance();
        const validColor = color => /^#[0-9a-f]{6}$/i.test(color || "") ? color : "";
        const legacyColor = validColor(appearance.bubbleColor);
        const receivedColor = validColor(appearance.receivedBubbleColor) || legacyColor;
        const sentColor = validColor(appearance.sentBubbleColor) || legacyColor;
        const fontColor = validColor(appearance.fontColor);
        const generalBg = (() => {
            try { return localStorage.getItem("uassapp-solid-background") || (document.documentElement.dataset.theme === "dark" ? "#0b141a" : "#efeae2"); }
            catch { return document.documentElement.dataset.theme === "dark" ? "#0b141a" : "#efeae2"; }
        })();
        let backgroundMode = "system";
        try { backgroundMode = localStorage.getItem("uassapp-solid-background-mode") || "system"; } catch { }
        messagesEl.style.backgroundColor = appearance.background ? "" : (backgroundMode === "custom" ? generalBg : defaultSolidBg());
        messagesEl.style.backgroundImage = appearance.background ? `url("${appearance.background}")` : "";
        messagesEl.style.backgroundSize = appearance.background ? `${appearance.zoom || 100}% auto` : "";
        messagesEl.style.backgroundRepeat = appearance.background ? (appearance.imageMode === "once" ? "no-repeat" : "repeat") : "";
        messagesEl.style.backgroundPosition = appearance.background
            ? (appearance.fit === "custom" ? `${appearance.x ?? 50}% ${appearance.y ?? 50}%` : "center") : "";
        messagesEl.querySelectorAll(".bubble").forEach(bubble => {
            bubble.style.backgroundColor = bubble.classList.contains("outgoing") ? sentColor : receivedColor;
            bubble.style.color = fontColor;
        });
    }
    function updateAppearanceDialog() {
        const appearance = getChatAppearance();
        backgroundFit.value = appearance.fit === "custom" ? "custom" : "auto";
        backgroundRepeat.value = appearance.imageMode === "once" ? "once" : "repeat";
        cropX.value = appearance.x ?? 50;
        cropY.value = appearance.y ?? 50;
        backgroundZoom.value = appearance.zoom ?? 100;
        backgroundZoomValue.textContent = `${backgroundZoom.value}%`;
        receivedBubbleColor.value = /^#[0-9a-f]{6}$/i.test(appearance.receivedBubbleColor || appearance.bubbleColor || "") ? (appearance.receivedBubbleColor || appearance.bubbleColor) : "#fff4d6";
        sentBubbleColor.value = /^#[0-9a-f]{6}$/i.test(appearance.sentBubbleColor || appearance.bubbleColor || "") ? (appearance.sentBubbleColor || appearance.bubbleColor) : "#d9eaff";
        messageFontColor.value = /^#[0-9a-f]{6}$/i.test(appearance.fontColor || "") ? appearance.fontColor : "#111b21";
        customCropControls.hidden = backgroundFit.value !== "custom";
        chatBackgroundFile.value = "";
    }
    function updateActiveAppearance(patch) {
        if (!activeId) return;
        chatAppearances[activeId] = { ...getChatAppearance(), ...patch };
        saveChatAppearances();
        applyChatAppearance();
    }
    function openAppearanceDialog() {
        if (!activeId) return;
        updateAppearanceDialog();
        appearanceDialog.showModal();
    }

    try { usernameInput.value = localStorage.getItem(STORAGE_USERNAME_KEY) || ""; } catch { }

    // ============================================================
    // IndexedDB
    // ============================================================
    function openDb() {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(IDB_NAME, IDB_VERSION);
            req.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains("identity")) db.createObjectStore("identity");
                if (!db.objectStoreNames.contains("contacts")) db.createObjectStore("contacts", { keyPath: "id" });
                if (!db.objectStoreNames.contains("messages")) {
                    const s = db.createObjectStore("messages", { keyPath: "id" });
                    s.createIndex("byConversation", ["conversationId", "timestamp"]);
                }
                if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta");
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }
    async function dbGet(store, key) {
        const db = await openDb();
        return new Promise((res, rej) => {
            const r = db.transaction(store, "readonly").objectStore(store).get(key);
            r.onsuccess = () => res(r.result);
            r.onerror = () => rej(r.error);
        });
    }
    async function dbPut(store, value, key) {
        const db = await openDb();
        return new Promise((res, rej) => {
            const s = db.transaction(store, "readwrite").objectStore(store);
            const r = key !== undefined ? s.put(value, key) : s.put(value);
            r.onsuccess = () => res();
            r.onerror = () => rej(r.error);
        });
    }
    async function dbDelete(store, key) {
        const db = await openDb();
        return new Promise((res, rej) => {
            const r = db.transaction(store, "readwrite").objectStore(store).delete(key);
            r.onsuccess = () => res();
            r.onerror = () => rej(r.error);
        });
    }
    async function dbGetAll(store) {
        const db = await openDb();
        return new Promise((res, rej) => {
            const r = db.transaction(store, "readonly").objectStore(store).getAll();
            r.onsuccess = () => res(r.result || []);
            r.onerror = () => rej(r.error);
        });
    }

    async function clearLocalAccountData() {
        const db = await openDb();
        await new Promise((resolve, reject) => {
            const transaction = db.transaction(Array.from(db.objectStoreNames), "readwrite");
            for (const store of Array.from(db.objectStoreNames)) {
                transaction.objectStore(store).clear();
            }
            transaction.oncomplete = resolve;
            transaction.onerror = () => reject(transaction.error);
            transaction.onabort = () => reject(transaction.error || new Error("Local account data could not be cleared."));
        }).finally(() => db.close());
        for (const key of Object.keys(localStorage)) {
            if (key.startsWith("uassapp-")) localStorage.removeItem(key);
        }
    }

    // ============================================================
    // Crypto helpers
    // ============================================================
    const enc = new TextEncoder();
    const dec = new TextDecoder();
    const b64 = (buf) => {
        const bytes = new Uint8Array(buf);
        let s = ""; for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
        return btoa(s);
    };
    const b64ToBuf = (s) => {
        const bin = atob(s); const out = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
        return out;
    };
    const concat = (...a) => {
        const n = a.reduce((s, x) => s + x.byteLength, 0);
        const o = new Uint8Array(n); let p = 0;
        for (const x of a) { o.set(x, p); p += x.byteLength; }
        return o;
    };

    async function loadIdentity(username) {
        const normalized = normalizeUsername(username);
        if (!normalized) throw new Error("Username required");

        const stored = await dbGet("identity", "keys");
        if (stored && stored.encKeyPair && stored.sigKeyPair) {
            if (!stored.username) {
                stored.username = normalized;
                await dbPut("identity", stored, "keys");
                return stored;
            }
            if (stored.username === normalized) return stored;
        }

        const encKeyPair = await crypto.subtle.generateKey(
            { name: "RSA-OAEP", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
            true, ["encrypt", "decrypt"]);
        const sigKeyPair = await crypto.subtle.generateKey(
            { name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
        const ident = {
            username: normalized,
            encKeyPair, sigKeyPair,
            encPublicKey: b64(await crypto.subtle.exportKey("spki", encKeyPair.publicKey)),
            sigPublicKey: b64(await crypto.subtle.exportKey("spki", sigKeyPair.publicKey))
        };
        await dbPut("identity", ident, "keys");
        return ident;
    }

    const importEncPub = (k) => crypto.subtle.importKey(
        "spki", b64ToBuf(k), { name: "RSA-OAEP", hash: "SHA-256" }, false, ["encrypt"]);
    const importSigPub = (k) => crypto.subtle.importKey(
        "spki", b64ToBuf(k), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);

    async function encryptFor(recipientEncPubB64, obj) {
        const recipientKey = await importEncPub(recipientEncPubB64);
        const aesKey = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt"]);
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const full = new Uint8Array(await crypto.subtle.encrypt(
            { name: "AES-GCM", iv, tagLength: 128 }, aesKey, enc.encode(JSON.stringify(obj))));
        const ct = full.slice(0, -16), tag = full.slice(-16);
        const rawAes = await crypto.subtle.exportKey("raw", aesKey);
        const wrapped = new Uint8Array(await crypto.subtle.encrypt({ name: "RSA-OAEP" }, recipientKey, rawAes));
        const header = new Uint8Array([(wrapped.byteLength >>> 8) & 0xff, wrapped.byteLength & 0xff]);
        return b64(concat(header, wrapped, iv, tag, ct));
    }
    async function decryptWith(privKey, ciphertextB64) {
        const buf = b64ToBuf(ciphertextB64);
        const wl = (buf[0] << 8) | buf[1];
        let o = 2;
        const wrapped = buf.slice(o, o + wl); o += wl;
        const iv = buf.slice(o, o + 12); o += 12;
        const tag = buf.slice(o, o + 16); o += 16;
        const ct = buf.slice(o);
        const rawAes = await crypto.subtle.decrypt({ name: "RSA-OAEP" }, privKey, wrapped);
        const aesKey = await crypto.subtle.importKey("raw", rawAes, { name: "AES-GCM" }, false, ["decrypt"]);
        const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv, tagLength: 128 }, aesKey, concat(ct, tag));
        return JSON.parse(dec.decode(pt));
    }
    async function sign(sigPrivKey, obj) {
        return b64(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" },
            sigPrivKey, enc.encode(JSON.stringify(obj))));
    }
    async function verify(sigPubB64, obj, sigB64) {
        const pub = await importSigPub(sigPubB64);
        return crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" },
            pub, b64ToBuf(sigB64), enc.encode(JSON.stringify(obj)));
    }
    async function signChallenge(sigPrivKey, chB64) {
        return b64(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" },
            sigPrivKey, b64ToBuf(chB64)));
    }

    // ============================================================
    // UI helpers
    // ============================================================
    const normalizeUsername = (username) => String(username || "").trim().replace(/^@/, "").slice(0, 30);
    const savedTheme = (() => { try { return localStorage.getItem("uassapp-theme") || "system"; } catch { return "system"; } })();
    const savedFont = (() => { try { return localStorage.getItem("uassapp-font") || "system"; } catch { return "system"; } })();
    const savedEnterToSend = (() => { try { return localStorage.getItem("uassapp-enter-to-send") !== "false"; } catch { return true; } })();
    const savedAutoFocus = (() => { try { return localStorage.getItem("uassapp-auto-focus") !== "false"; } catch { return true; } })();
    function setTheme(theme) {
        const selected = ["system", "dark", "light"].includes(theme) ? theme : "system";
        const effective = selected === "system"
            ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
            : selected;
        document.documentElement.dataset.theme = effective;
        themeSelect.value = selected;
        try { localStorage.setItem("uassapp-theme", selected); } catch { }
    }
    setTheme(savedTheme);
    const defaultSolidBg = () => document.documentElement.dataset.theme === "dark" ? "#0b141a" : "#efeae2";
    const savedSolidBg = (() => { try { return localStorage.getItem("uassapp-solid-background"); } catch { return null; } })();
    const savedBackgroundMode = (() => { try { return localStorage.getItem("uassapp-solid-background-mode") || (savedSolidBg ? "custom" : "system"); } catch { return savedSolidBg ? "custom" : "system"; } })();
    generalBackgroundMode.value = savedBackgroundMode;
    solidBackgroundColor.value = savedSolidBg || defaultSolidBg();
    solidBackgroundColor.hidden = savedBackgroundMode !== "custom";
    const savedPalette = (() => { try { return localStorage.getItem("uassapp-interface-palette") || "#00a884"; } catch { return "#00a884"; } })();
    document.documentElement.style.setProperty("--accent", savedPalette);
    interfacePalette.value = savedPalette;
    solidBackgroundColor.addEventListener("input", () => {
        generalBackgroundMode.value = "custom";
        solidBackgroundColor.hidden = false;
        try { localStorage.setItem("uassapp-solid-background-mode", "custom"); } catch { }
        try { localStorage.setItem("uassapp-solid-background", solidBackgroundColor.value); } catch { }
        if (!getChatAppearance().background) applyChatAppearance();
    });
    generalBackgroundMode.addEventListener("change", () => {
        solidBackgroundColor.hidden = generalBackgroundMode.value !== "custom";
        try { localStorage.setItem("uassapp-solid-background-mode", generalBackgroundMode.value); } catch { }
        if (generalBackgroundMode.value === "system") solidBackgroundColor.value = defaultSolidBg();
        if (!getChatAppearance().background) applyChatAppearance();
    });
    interfacePalette.addEventListener("change", () => {
        document.documentElement.style.setProperty("--accent", interfacePalette.value);
        try { localStorage.setItem("uassapp-interface-palette", interfacePalette.value); } catch { }
    });
    function setFont(font) {
        const fonts = { system: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", arial: "Arial, Helvetica, sans-serif", georgia: "Georgia, serif", verdana: "Verdana, Geneva, sans-serif" };
        const selected = Object.hasOwn(fonts, font) ? font : "system";
        document.documentElement.style.setProperty("--app-font-family", fonts[selected]);
        fontSelect.value = selected;
        try { localStorage.setItem("uassapp-font", selected); } catch { }
    }
    setFont(savedFont);
    enterToSend.checked = savedEnterToSend;
    autoFocus.checked = savedAutoFocus;
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
        if (themeSelect.value === "system") {
            setTheme("system");
            if (generalBackgroundMode.value === "system") solidBackgroundColor.value = defaultSolidBg();
            if (!getChatAppearance().background) applyChatAppearance();
        }
    });
    const profilePanel = document.querySelector(".profile");
    const settingsProfileSlot = $("settingsProfileSlot");
    function showSettingsCategory(category) {
        document.querySelectorAll("[data-settings-category]").forEach(button => button.setAttribute("aria-current", String(button.dataset.settingsCategory === category)));
        document.querySelectorAll("[data-settings-panel]").forEach(panel => panel.hidden = panel.dataset.settingsPanel !== category);
    }
    function openSettings() {
        settingsProfileSlot.append(profilePanel);
        profilePanel.hidden = false;
        showSettingsCategory("appearance");
        settingsScreen.classList.add("settings-open");
        settingsScreen.setAttribute("aria-hidden", "false");
        app.classList.add("settings-open", "chat-open");
    }
    function closeSettings() {
        document.querySelector(".sidebar").insertBefore(profilePanel, document.querySelector(".search-wrap"));
        profilePanel.hidden = !!registeredUsername;
        settingsScreen.classList.remove("settings-open");
        settingsScreen.setAttribute("aria-hidden", "true");
        app.classList.remove("settings-open", "chat-open");
    }
    $("settingsButton").addEventListener("click", openSettings);
    $("settingsBack").addEventListener("click", closeSettings);
    document.querySelectorAll("[data-settings-category]").forEach(button => button.addEventListener("click", () => showSettingsCategory(button.dataset.settingsCategory)));
    themeSelect.addEventListener("change", () => {
        setTheme(themeSelect.value);
        if (generalBackgroundMode.value === "system") solidBackgroundColor.value = defaultSolidBg();
        if (!getChatAppearance().background) applyChatAppearance();
    });
    fontSelect.addEventListener("change", () => setFont(fontSelect.value));
    enterToSend.addEventListener("change", () => {
        try { localStorage.setItem("uassapp-enter-to-send", String(enterToSend.checked)); } catch { }
    });
    autoFocus.addEventListener("change", () => {
        try { localStorage.setItem("uassapp-auto-focus", String(autoFocus.checked)); } catch { }
    });
    accountStatusAlerts.addEventListener("change", () => {
        try { localStorage.setItem("uassapp-account-status-alerts", String(accountStatusAlerts.checked)); } catch { }
        if (!accountStatusAlerts.checked) dismissUserDeletedAlert();
    });
    keyChangeAlerts.addEventListener("change", () => {
        try { localStorage.setItem("uassapp-key-change-alerts", String(keyChangeAlerts.checked)); } catch { }
        if (activeId) renderMessages();
    });
    const getUsername = () => normalizeUsername(usernameInput.value);
    let confirmedUsername = getUsername();
    function getSavedUsername() {
        try { return normalizeUsername(localStorage.getItem(STORAGE_USERNAME_KEY)); }
        catch { return ""; }
    }
    function showPopup(title, message, continueToChat = false, popupClass = "") {
        if (popupConfirmationResolver) popupConfirmationResolver(false);
        popupConfirmationResolver = null;
        if (appPopup.open) appPopup.close();
        appPopup.classList.toggle("user-deleted-popup", popupClass === "user-deleted-popup");
        popupTitle.textContent = title;
        popupMessage.textContent = message;
        popupContinue.hidden = !continueToChat;
        popupConfirmActions.hidden = true;
        const usernameToRestore = registeredUsername || getSavedUsername() || confirmedUsername;
        popupContinue.textContent = usernameToRestore
            ? `Continue as @${usernameToRestore}` : "Continue to chat";
        if (popupClass === "user-deleted-popup" && window.matchMedia("(min-width: 701px)").matches) {
            appPopup.show();
        } else {
            appPopup.showModal();
        }
    }
    function confirmPopup(title, message, confirmLabel) {
        if (popupConfirmationResolver) popupConfirmationResolver(false);
        if (appPopup.open) appPopup.close();
        appPopup.classList.remove("user-deleted-popup");
        popupTitle.textContent = title;
        popupMessage.textContent = message;
        popupContinue.hidden = true;
        popupClose.hidden = true;
        popupConfirm.textContent = confirmLabel;
        popupConfirmActions.hidden = false;
        appPopup.showModal();
        return new Promise(resolve => { popupConfirmationResolver = resolve; });
    }
    function finishPopupConfirmation(confirmed) {
        const resolve = popupConfirmationResolver;
        popupConfirmationResolver = null;
        popupConfirmActions.hidden = true;
        popupClose.hidden = false;
        if (appPopup.open) appPopup.close();
        resolve?.(confirmed);
    }
    function requireUsername(contactId = null) {
        if (getUsername()) return false;
        pendingContactId = contactId;
        const message = registeredUsername
            ? `You're already registered as @${registeredUsername}. Restore @${registeredUsername} in the username field to keep using it, or enter and confirm another username before chatting.`
            : "Add and confirm a username before starting or continuing a chat.";
        showPopup("Choose a username", message, true);
        usernameInput.focus();
        return true;
    }
    popupClose.addEventListener("click", () => {
        if (popupConfirmationResolver) finishPopupConfirmation(false);
        else {
            appPopup.close();
            appPopup.classList.remove("user-deleted-popup");
        }
    });
    popupConfirm.addEventListener("click", () => finishPopupConfirmation(true));
    popupCancel.addEventListener("click", () => finishPopupConfirmation(false));
    appPopup.addEventListener("cancel", () => {
        if (popupConfirmationResolver) finishPopupConfirmation(false);
        dismissUserDeletedAlert();
    });
    appPopup.addEventListener("click", event => event.stopPropagation());
    appPopup.addEventListener("close", () => {
        if (!appPopup.open) appPopup.classList.remove("user-deleted-popup");
    });
    popupContinue.addEventListener("click", () => {
        const contactId = pendingContactId;
        pendingContactId = null;
        const usernameToRestore = registeredUsername || getSavedUsername() || confirmedUsername;
        if (usernameToRestore) {
            usernameInput.value = usernameToRestore;
            confirmedUsername = usernameToRestore;
            usernameConfirm.hidden = true;
            try { localStorage.setItem(STORAGE_USERNAME_KEY, usernameToRestore); } catch { }
            showUsernameStatus("Username restored" + (socket?.readyState === WebSocket.OPEN ? " — registering…" : ""));
            if (socket?.readyState === WebSocket.OPEN) register(usernameToRestore);
        }
        appPopup.close();
        if (contactId) selectContact(contactId);
    });
    const showUsernameStatus = (t, ok = false) => {
        usernameStatus.textContent = t;
        usernameStatus.classList.toggle("confirmed", ok);
    };

    function updateChatSubtitle() {
        const c = activeId ? contactMap.get(activeId) : null;
        blockChatMenuItem.disabled = !c;
        blockChatMenuItem.textContent = c?.blocked ? "Unblock chat" : "Block chat";
        if (!activeId) {
            activeSubtitle.textContent = "Messages are sent over a secure connection";
            return;
        }
        if (!c) return;
        if (c.blocked) {
            activeSubtitle.textContent = "You blocked this chat";
            return;
        }
        if (c.deleted) {
            activeSubtitle.textContent = "This account was deleted";
            return;
        }
        if (socket?.readyState !== WebSocket.OPEN) {
            activeSubtitle.textContent = "You're offline — reconnecting…";
            return;
        }
        if (!registeredUsername) {
            activeSubtitle.textContent = "Registering…";
            return;
        }
        activeSubtitle.textContent = c.profile.bio || (c.online ? "online" : "last seen recently");
    }

    function updateComposerState() {
        const connected = socket?.readyState === WebSocket.OPEN;
        const registered = !!registeredUsername;
        const canDraft = !!activeId;
        const contact = contactMap.get(activeId);
        const blocked = !!contact?.blocked;
        const deleted = !!contact?.deleted;
        input.disabled = !canDraft || blocked || deleted;
        sendButton.disabled = !(connected && registered && canDraft && !blocked && !deleted);
        if (!canDraft) input.placeholder = "Select a chat to message";
        else if (blocked) input.placeholder = "This chat is blocked";
        else if (deleted) input.placeholder = "This account was deleted";
        else if (!connected) input.placeholder = "Offline — reconnecting…";
        else if (!registered) input.placeholder = "Registering…";
        else input.placeholder = "Type a message";
    }

    const setStatus = (t, s) => {
        statusText.textContent = t;
        statusDot.className = "dot " + s;
        updateChatSubtitle();
        updateComposerState();
    };

    function getContact(id, name) {
        const key = String(id || name || "unknown").toLowerCase();
        if (!contactMap.has(key)) {
            contactMap.set(key, {
                id: key, name: String(name || id || key),
                messages: [], online: false,
                publicKey: null, sigPublicKey: null,
                blocked: blockedUsernames.has(key),
                profile: {}
            });
        }
        const c = contactMap.get(key);
        if (name) c.name = String(name);
        return c;
    }
    function setAvatar(element, name, profile = {}) {
        element.replaceChildren();
        element.textContent = (profile.displayName || name || "?").trim().charAt(0).toUpperCase() || "?";
        const avatarUrl = typeof profile.avatar === "string" ? profile.avatar : "";
        if (!/^https?:\/\//i.test(avatarUrl)) return;
        const image = document.createElement("img");
        image.src = avatarUrl;
        image.alt = "";
        image.referrerPolicy = "no-referrer";
        image.addEventListener("error", () => {
            element.replaceChildren(document.createTextNode(
                (profile.displayName || name || "?").trim().charAt(0).toUpperCase() || "?"
            ));
        }, { once: true });
        element.replaceChildren(image);
    }
    async function saveContact(c) {
        await dbPut("contacts", {
            id: c.id, name: c.name,
            publicKey: c.publicKey, sigPublicKey: c.sigPublicKey,
            profile: c.profile || {},
            deleted: !!c.deleted
        });
    }
    async function saveMessage(m) { await dbPut("messages", m); }
    async function recordKeyChange(c) {
        if (!keyChangeAlerts.checked) return;
        const notice = {
            id: crypto.randomUUID(),
            conversationId: c.id,
            kind: "key-change",
            text: `Se cambiaron las claves de cifrado de @${c.name}.`,
            timestamp: Date.now()
        };
        c.messages.push(notice);
        await saveMessage(notice);
        if (activeId === c.id) renderMessages();
    }
    async function updateContactKeys(c, publicKey, sigPublicKey) {
        const nextPublicKey = typeof publicKey === "string" && publicKey ? publicKey : null;
        const nextSigPublicKey = typeof sigPublicKey === "string" && sigPublicKey ? sigPublicKey : null;
        const changed = Boolean(
            (nextPublicKey && c.publicKey && c.publicKey !== nextPublicKey) ||
            (nextSigPublicKey && c.sigPublicKey && c.sigPublicKey !== nextSigPublicKey)
        );
        if (nextPublicKey) c.publicKey = nextPublicKey;
        if (nextSigPublicKey) c.sigPublicKey = nextSigPublicKey;
        if (changed) await recordKeyChange(c);
        await saveContact(c);
        return changed;
    }
    function requestContactLookup(c, notifyIfDeleted = false) {
        if (socket?.readyState !== WebSocket.OPEN) return Promise.resolve(false);
        const requestId = crypto.randomUUID();
        return new Promise(resolve => {
            const timer = setTimeout(() => {
                pendingContactLookups.delete(requestId);
                resolve(false);
            }, 8000);
            pendingContactLookups.set(requestId, { contactId: c.id, timer, resolve, notifyIfDeleted });
            try {
                socket.send(JSON.stringify({
                    type: "user.lookup",
                    username: c.name,
                    requestId
                }));
            } catch (error) {
                clearTimeout(timer);
                pendingContactLookups.delete(requestId);
                console.error("Could not refresh chat keys:", error);
                resolve(false);
            }
        });
    }
    function finishContactLookup(requestId, success) {
        const pending = pendingContactLookups.get(requestId);
        if (!pending) return;
        clearTimeout(pending.timer);
        pendingContactLookups.delete(requestId);
        const contact = contactMap.get(pending.contactId);
        pending.resolve(Boolean(success && contact?.publicKey && contact?.sigPublicKey));
    }

    function statusIcon(s) {
        switch (s) {
            case "pending": return `<svg width="800px" height="800px" viewBox="0 -4 24 24" id="meteor-icon-kit__solid-checkmark" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="8" r="10" fill="#588d92"/><circle cx="12" cy="8" r="6.5" stroke="#62ff66" stroke-width="1.5"/><path d="M12 4V8L15 10" stroke="#d8fc85" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
            case "sent": return `<svg width="800px" height="800px" viewBox="0 -4 24 24" id="meteor-icon-kit__solid-checkmark" fill="none" xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" clip-rule="evenodd" d="M3.06066 6.4393C2.47487 5.85355 1.52513 5.85355 0.93934 6.4393C0.353553 7.0251 0.353553 7.9749 0.93934 8.5607L7.93934 15.5607C8.52513 16.1464 9.47487 16.1464 10.0607 15.5607L23.0607 2.56066C23.6464 1.97487 23.6464 1.02513 23.0607 0.43934C22.4749 -0.14645 21.5251 -0.14645 20.9393 0.43934L9 12.3787L3.06066 6.4393z" fill="#739DA6"/></svg>`;
            case "delivered": return `<svg width="800px" height="800px" viewBox="0 -4 24 24" id="meteor-icon-kit__solid-checkmark" fill="none" xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" clip-rule="evenodd" d="M3.06066 6.4393C2.47487 5.85355 1.52513 5.85355 0.93934 6.4393C0.353553 7.0251 0.353553 7.9749 0.93934 8.5607L7.93934 15.5607C8.52513 16.1464 9.47487 16.1464 10.0607 15.5607L23.0607 2.56066C23.6464 1.97487 23.6464 1.02513 23.0607 0.43934C22.4749 -0.14645 21.5251 -0.14645 20.9393 0.43934L9 12.3787L3.06066 6.4393z" fill="#ACACAC"/></svg><svg width="800px" height="800px" viewBox="0 -4 24 24" id="meteor-icon-kit__solid-checkmark" fill="none" xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" clip-rule="evenodd" d="M3.06066 6.4393C2.47487 5.85355 1.52513 5.85355 0.93934 6.4393C0.353553 7.0251 0.353553 7.9749 0.93934 8.5607L7.93934 15.5607C8.52513 16.1464 9.47487 16.1464 10.0607 15.5607L23.0607 2.56066C23.6464 1.97487 23.6464 1.02513 23.0607 0.43934C22.4749 -0.14645 21.5251 -0.14645 20.9393 0.43934L9 12.3787L3.06066 6.4393z" fill="#ACACAC"/></svg>`;
            case "read": return `<svg width="800px" height="800px" viewBox="0 -4 24 24" id="meteor-icon-kit__solid-checkmark" fill="none" xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" clip-rule="evenodd" d="M3.06066 6.4393C2.47487 5.85355 1.52513 5.85355 0.93934 6.4393C0.353553 7.0251 0.353553 7.9749 0.93934 8.5607L7.93934 15.5607C8.52513 16.1464 9.47487 16.1464 10.0607 15.5607L23.0607 2.56066C23.6464 1.97487 23.6464 1.02513 23.0607 0.43934C22.4749 -0.14645 21.5251 -0.14645 20.9393 0.43934L9 12.3787L3.06066 6.4393z" fill="#9785fc"/></svg><svg width="800px" height="800px" viewBox="0 -4 24 24" id="meteor-icon-kit__solid-checkmark" fill="none" xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" clip-rule="evenodd" d="M3.06066 6.4393C2.47487 5.85355 1.52513 5.85355 0.93934 6.4393C0.353553 7.0251 0.353553 7.9749 0.93934 8.5607L7.93934 15.5607C8.52513 16.1464 9.47487 16.1464 10.0607 15.5607L23.0607 2.56066C23.6464 1.97487 23.6464 1.02513 23.0607 0.43934C22.4749 -0.14645 21.5251 -0.14645 20.9393 0.43934L9 12.3787L3.06066 6.4393z" fill="#9785fc"/></svg>`;
            case "failed": return `<svg width="800px" height="800px" viewBox="0 -4 24 24" id="meteor-icon-kit__solid-checkmark" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="8" r="10" fill="#eb3c01"/><path d="M11 2H13L12.75 11H11.25L11 2ZM12 15.5C11.17 15.5 10.5 14.83 10.5 14C10.5 13.17 11.17 12.5 12 12.5C12.83 12.5 13.5 13.17 13.5 14C13.5 14.83 12.83 15.5 12 15.5Z" fill="#c0c0c0"/></svg>`;
            default: return "";
        }
    }
    function makeBubble(m) {
        const b = document.createElement("div");
        b.className = "bubble" + (m.direction === "out" ? " outgoing" : "");
        b.dataset.messageId = String(m.id);
        b.append(document.createTextNode(String(m.text ?? "")));
        const actions = document.createElement("span");
        actions.className = "message-actions";
        const copy = document.createElement("button");
        copy.type = "button"; copy.dataset.action = "copy";
        copy.setAttribute("aria-label", "Copy message"); copy.textContent = "Copy";
        const remove = document.createElement("button");
        remove.type = "button"; remove.dataset.action = "remove";
        remove.setAttribute("aria-label", "Remove message for me"); remove.textContent = "Remove";
        actions.append(copy, remove);
        b.append(actions);
        const time = document.createElement("span");
        time.className = "time";
        time.textContent = new Date(m.timestamp || Date.now())
            .toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        if (m.direction === "out") {
            const st = document.createElement("span");
            st.className = "status" + (m.status === "read" ? " read" : "");
            // st.textContent = " " + statusIcon(m.status);
            st.innerHTML = " " + statusIcon(m.status);
            time.append(st);
        }
        b.append(time);
        return b;
    }
    function renderMessages(forceBottom = false) {
        const wasNearBottom = messagesEl.scrollHeight - messagesEl.clientHeight - messagesEl.scrollTop < 80;
        const selection = window.getSelection();
        let selected = null;
        if (selection?.rangeCount && selection.anchorNode?.nodeType === Node.TEXT_NODE) {
            const bubble = selection.anchorNode.parentElement?.closest(".bubble");
            if (bubble && bubble.contains(selection.focusNode) && selection.focusNode.nodeType === Node.TEXT_NODE) {
                selected = { id: bubble.dataset.messageId, start: selection.anchorOffset, end: selection.focusOffset };
            }
        }
        const previousTop = messagesEl.scrollTop;
        messagesEl.replaceChildren();
        const c = contactMap.get(activeId);
        if (!c || !c.messages.length) {
            const note = document.createElement("div");
            note.className = "welcome";
            note.textContent = "No messages yet. Send a message to start the conversation.";
            messagesEl.append(note);
        } else c.messages.forEach(m => {
            if (m.kind === "key-change" || m.kind === "system") {
                if (!keyChangeAlerts.checked) return;
                const card = document.createElement("div");
                card.className = "system-card";
                card.textContent = String(m.text || "");
                messagesEl.append(card);
            } else {
                messagesEl.append(makeBubble(m));
            }
        });
        if (forceBottom || wasNearBottom) messagesEl.scrollTop = messagesEl.scrollHeight;
        else messagesEl.scrollTop = previousTop;
        if (selected) {
            const bubble = [...messagesEl.querySelectorAll(".bubble")].find(el => el.dataset.messageId === selected.id);
            const text = bubble?.firstChild;
            if (text?.nodeType === Node.TEXT_NODE) {
                const range = document.createRange();
                range.setStart(text, Math.min(selected.start, text.length));
                range.setEnd(text, Math.min(selected.end, text.length));
                selection.removeAllRanges(); selection.addRange(range);
            }
        }
        applyChatAppearance();
    }
    function unreadCount(c) {
        return c.messages.filter(m => m.direction === "in" && m.status === "unread").length;
    }
    function renderContacts() {
        const q = searchInput.value.trim().toLowerCase();
        const online = [...contactMap.values()].filter(c => c.online).length;
        onlineSummary.textContent = online
            ? `${online} user${online === 1 ? "" : "s"} online` : "No users online";

        contactsEl.replaceChildren();
        const list = [...contactMap.values()]
            .filter(c => c.name.toLowerCase().includes(q) || (c.profile.displayName || "").toLowerCase().includes(q))
            .sort((a, b) =>
                (unreadCount(b) > 0) - (unreadCount(a) > 0) ||
                Number(b.online) - Number(a.online) ||
                a.name.localeCompare(b.name));

        if (!list.length) {
            const e = document.createElement("div");
            e.className = "empty";
            e.textContent = q ? "No matching chats" : "Chats will appear here when messages arrive";
            contactsEl.append(e); return;
        }
        for (const c of list) {
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "contact" + (c.id === activeId ? " active" : "");
            btn.dataset.id = c.id;
            const av = document.createElement("span");
            av.className = "avatar";
            setAvatar(av, c.name, c.profile);
            const info = document.createElement("span");
            info.className = "contact-info";
            const nm = document.createElement("span");
            nm.className = "contact-name"; nm.textContent = c.profile.displayName || c.name;
            const pv = document.createElement("span");
            pv.className = "preview";
            const last = c.messages.at(-1);
            pv.textContent = c.deleted
                ? "Account deleted"
                : last ? String(last.text ?? "") : c.profile.bio || `@${c.name}`;
            info.append(nm, pv);
            btn.append(av, info);
            const u = unreadCount(c);
            if (u > 0) {
                const bdg = document.createElement("span");
                bdg.className = "unread-badge";
                bdg.textContent = u > 99 ? "99+" : String(u);
                btn.append(bdg);
            }
            const pr = document.createElement("span");
            pr.className = "presence" + (c.online ? " online" : "");
            btn.append(pr);
            btn.addEventListener("click", () => selectContact(c.id));
            contactsEl.append(btn);
        }
        updateChatSubtitle();
    }

    async function selectContact(id, continueWithoutUsername = false) {
        if (!continueWithoutUsername && requireUsername(id)) return;
        dismissUserDeletedAlert();
        activeId = id;
        const c = contactMap.get(id);
        activeName.textContent = c.profile.displayName || c.name;
        setAvatar(activeAvatar, c.name, c.profile);
        applyChatAppearance();
        document.querySelectorAll(".contact").forEach(el =>
            el.classList.toggle("active", el.dataset.id === id));
        app.classList.add("chat-open");
        renderMessages(true);
        updateChatSubtitle();
        updateComposerState();
        if (autoFocus.checked && window.matchMedia("(min-width: 701px)").matches) input.focus();
        requestContactLookup(c, true);
        await markConversationRead(id);
    }

    async function markConversationRead(convId) {
        const c = contactMap.get(convId);
        if (!c) return;
        const unread = c.messages.filter(m => m.direction === "in" && m.status === "unread");
        if (!unread.length) return;
        for (const m of unread) { m.status = "read"; await saveMessage(m); }
        if (socket?.readyState === WebSocket.OPEN && c.publicKey && registeredUsername && identity) {
            await sendReceipt(c, unread.map(m => m.id), "read");
        }
        renderContacts();
    }

    async function sendReceipt(contact, messageIds, status) {
        if (!contact.publicKey || !registeredUsername || !identity) return;
        const payload = {
            messageIds, status,
            from: registeredUsername, to: contact.name,
            timestamp: Date.now()
        };
        const signature = await sign(identity.sigKeyPair.privateKey, payload);
        const data = await encryptFor(contact.publicKey, {
            payload, signature, sigPublicKey: identity.sigPublicKey
        });
        socket.send(JSON.stringify({ type: "message.receipt", to: contact.name, data }));
    }

    // ============================================================
    // Conexión
    // ============================================================
    function connect() {
        clearTimeout(reconnectTimer);
        setStatus("Connecting…", "");
        socket = new WebSocket(SOCKET_URL);
        socket.addEventListener("open", () => {
            retryDelay = 1000;
            setStatus("Connected — registering…", "online");
            const u = getUsername();
            if (u) register(u);
            else setStatus("Choose a username", "online");
        });
        socket.addEventListener("message", (ev) =>
            handleIncoming(ev.data).catch(e => console.error(e)));
        socket.addEventListener("close", () => {
            clearInterval(presenceTimer);
            presenceTimer = null;
            for (const pending of pendingContactLookups.values()) {
                clearTimeout(pending.timer);
                pending.resolve(false);
            }
            pendingContactLookups.clear();
            if (accountDeleted) return;
            registeredUsername = null;
            contactMap.forEach(c => { c.online = false; });
            renderContacts();
            setStatus("Disconnected", "offline");
            const delay = intentionalClose ? 200 : retryDelay;
            if (intentionalClose) intentionalClose = false;
            else retryDelay = Math.min(retryDelay * 2, 15000);
            reconnectTimer = setTimeout(connect, delay);
        });
        socket.addEventListener("error", () => setStatus("Connection error", "offline"));
    }

    async function register(username) {
        if (!socket || socket.readyState !== WebSocket.OPEN) return;
        const normalized = normalizeUsername(username);
        if (!normalized) return;
        try { localStorage.setItem(STORAGE_USERNAME_KEY, normalized); } catch { }

        let ident;
        try {
            ident = await loadIdentity(normalized);
        } catch (e) {
            console.error("loadIdentity:", e);
            showUsernameStatus("Could not prepare keys for @" + normalized);
            setStatus("Crypto unavailable", "offline");
            return;
        }
        // La conexión pudo cerrarse mientras generábamos claves
        if (!socket || socket.readyState !== WebSocket.OPEN) return;

        identity = ident;
        socket.send(JSON.stringify({
            type: "register.presence",
            username: normalized,
            encPublicKey: identity.encPublicKey,
            sigPublicKey: identity.sigPublicKey
        }));
    }

    // ============================================================
    // Handler de mensajes
    // ============================================================
    async function handleIncoming(raw) {
        let data; try { data = JSON.parse(raw); } catch { return; }
        if (!data || typeof data !== "object") return;

        if (data.type === "register.challenge") {
            if (!identity) return;
            const sig = await signChallenge(identity.sigKeyPair.privateKey, data.challenge);
            if (socket?.readyState !== WebSocket.OPEN) return;
            socket.send(JSON.stringify({ type: "register.verify", signature: sig }));
            return;
        }
        if (data.type === "register.ok") {
            registeredUsername = data.username;
            const profile = data.profile || {};
            profileDisplayName.value = typeof profile.displayName === "string" ? profile.displayName : "";
            profileBio.value = typeof profile.bio === "string" ? profile.bio : "";
            profileAvatar.value = typeof profile.avatar === "string" ? profile.avatar : "";
            profilePassword.value = "";
            blockedUsernames.clear();
            if (Array.isArray(data.blockedUsers)) {
                for (const username of data.blockedUsers) {
                    if (typeof username === "string") blockedUsernames.add(username.toLowerCase());
                }
            }
            contactMap.forEach(c => { c.blocked = blockedUsernames.has(c.name.toLowerCase()); });
            renderContacts();
            if (!settingsScreen.classList.contains("settings-open")) profilePanel.hidden = true;
            showUsernameStatus("Registered as @" + data.username, true);
            setStatus("Online", "online");
            socket.send(JSON.stringify({ type: "users.online" }));
            clearInterval(presenceTimer);
            presenceTimer = setInterval(() => {
                if (registeredUsername && socket?.readyState === WebSocket.OPEN) {
                    socket.send(JSON.stringify({ type: "users.online" }));
                }
            }, 30000);
            updateChatSubtitle();
            updateComposerState();
            if (activeId) {
                const activeContact = contactMap.get(activeId);
                if (activeContact) requestContactLookup(activeContact, true);
            }
            return;
        }
        if (data.type === "register.error") {
            registeredUsername = null;
            showUsernameStatus(data.error || "Registration failed");
            setStatus("Not registered", "offline");
            updateComposerState();
            return;
        }
        if (data.type === "users.online.result") {
            const list = Array.isArray(data.data?.users) ? data.data.users : [];
            contactMap.forEach(c => { c.online = false; });
            for (const u of list) {
                if (u === registeredUsername) continue;
                const contact = getContact(u, u);
                contact.online = true;
                contact.deleted = false;
            }
            renderContacts();
            updateChatSubtitle();
            return;
        }
        if (data.type === "user.lookup.result" || data.type === "contact.add.result") {
            const d = data.data || {};
            if (d.success && d.user?.username) {
                const c = getContact(d.user.username, d.user.username);
                c.deleted = false;
                await updateContactKeys(c, d.user.publicKey, d.user.sigPublicKey);
                if (d.user.profile && typeof d.user.profile === "object") {
                    c.profile = {
                        displayName: typeof d.user.profile.displayName === "string" ? d.user.profile.displayName : "",
                        bio: typeof d.user.profile.bio === "string" ? d.user.profile.bio : "",
                        avatar: typeof d.user.profile.avatar === "string" ? d.user.profile.avatar : ""
                    };
                    await saveContact(c);
                }
                finishContactLookup(data.requestId, true);
                renderContacts();
                if (activeId === c.id) {
                    activeName.textContent = c.profile.displayName || c.name;
                    setAvatar(activeAvatar, c.name, c.profile);
                    updateChatSubtitle();
                    updateComposerState();
                }
            } else {
                finishContactLookup(data.requestId, false);
            }
            return;
        }
        if (data.type === "user.keys.updated") {
            const username = typeof data.username === "string" ? data.username : "";
            const contact = contactMap.get(username.toLowerCase());
            if (!contact) return;
            contact.deleted = false;
            contact.online = true;
            await updateContactKeys(contact, data.publicKey, data.sigPublicKey);
            renderContacts();
            if (activeId === contact.id) {
                updateChatSubtitle();
                updateComposerState();
            }
            return;
        }
        if (data.type === "user.deleted") {
            const username = typeof data.username === "string" ? data.username : "";
            const pendingLookup = pendingContactLookups.get(data.requestId);
            finishContactLookup(data.requestId, false);
            const contact = contactMap.get(username.toLowerCase());
            if (contact) {
                contact.deleted = true;
                contact.online = false;
                await saveContact(contact);
                renderContacts();
                updateChatSubtitle();
                updateComposerState();
            }
            if (data.id) {
                const stored = await dbGet("messages", data.id);
                if (stored) {
                    stored.status = "failed";
                    await saveMessage(stored);
                    const message = contactMap.get(stored.conversationId)?.messages.find(item => item.id === data.id);
                    if (message) message.status = "failed";
                    if (activeId === stored.conversationId) renderMessages();
                }
            }
            if (accountStatusAlerts.checked && pendingLookup?.notifyIfDeleted && contact && activeId === contact.id) {
                showPopup("User deleted", username
                    ? `@${username} deleted their account. Messages cannot be sent to this username.`
                    : "This user deleted their account. Messages cannot be sent.", false, "user-deleted-popup");
            }
            return;
        }
        if (data.type === "update.profile.result") {
            if (data.data?.success) {
                profilePassword.value = "";
                showUsernameStatus("Profile saved", true);
            } else {
                showPopup("Could not save profile", data.data?.error || "Profile update failed.");
            }
            return;
        }
        if (data.type === "account.delete.result") {
            if (!data.data?.success) {
                showPopup("Could not delete account", data.data?.error || "Account deletion failed.");
                return;
            }
            accountDeleted = true;
            try {
                await clearLocalAccountData();
            } catch (error) {
                console.error("Failed to clear local account data after server deletion:", error);
                showPopup("Account deleted", "The server deleted the account, but local data could not be cleared. Clear this browser's site data to remove remaining chats and keys.");
                return;
            }
            contactMap.clear();
            blockedUsernames.clear();
            chatAppearances = {};
            activeId = null;
            identity = null;
            registeredUsername = null;
            usernameInput.value = "";
            confirmedUsername = "";
            profileDisplayName.value = "";
            profileBio.value = "";
            profileAvatar.value = "";
            profilePassword.value = "";
            socket?.close(1000, "Account deleted");
            app.classList.remove("chat-open", "settings-open");
            renderContacts();
            renderMessages();
            updateChatSubtitle();
            updateComposerState();
            showUsernameStatus("Account deleted");
            showPopup("Account deleted", "Your account, chats, messages, and keys were deleted from this device.");
            return;
        }
        if (data.type === "contact.list.update.result") {
            const result = data.data || {};
            if (data.requestId && data.requestId === pendingContactListRequestId) {
                clearTimeout(contactListUpdateTimer);
                contactListUpdateTimer = null;
                pendingContactListRequestId = null;
            }
            const username = typeof result.username === "string" ? result.username : "";
            const contact = contactMap.get(username.toLowerCase());
            if (result.success && (result.action === "block" || result.action === "unblock")) {
                const blocked = result.action === "block";
                if (blocked) blockedUsernames.add(username.toLowerCase());
                else blockedUsernames.delete(username.toLowerCase());
                if (contact) contact.blocked = blocked;
                renderContacts();
                updateChatSubtitle();
                updateComposerState();
                showPopup(blocked ? "Chat blocked" : "Chat unblocked",
                    blocked ? `You blocked @${contact?.name || username}.` : `You unblocked @${contact?.name || username}.`);
            } else if (!result.success) {
                showPopup("Could not block chat", result.error || "The chat could not be blocked.");
            }
            return;
        }

        if (data.type === "message.receive") {
            const msgId = data.id;
            if (await dbGet("messages", msgId)) return; // dedup

            const fromLower = String(data.from).toLowerCase();
            const c = getContact(data.from, data.from);

            let text = "[mensaje no descifrable]";
            let ts = data.timestamp || Date.now();
            let verified = false;
            let senderEncPub = null;

            try {
                const d = await decryptWith(identity.encKeyPair.privateKey, data.data);
                const { payload, signature, sigPublicKey } = d;
                if (payload && typeof payload.text === "string") {
                    if (signature && sigPublicKey) {
                        const ok = await verify(sigPublicKey, payload, signature);
                        if (ok) {
                            ts = payload.timestamp || ts;
                            senderEncPub = payload.senderEncPublicKey || null;
                            await updateContactKeys(c, senderEncPub, sigPublicKey);
                            text = payload.text;
                            verified = true;
                        } else text = "[firma inválida]";
                    } else text = payload.text;
                }
            } catch (e) { console.warn("decrypt failed:", e); }

            const isActive = activeId === fromLower;
            const msg = {
                id: msgId,
                conversationId: fromLower,
                direction: "in",
                text, timestamp: ts,
                status: isActive ? "read" : "unread",
                verified
            };
            c.messages.push(msg);
            await saveMessage(msg);

            if (verified && c.publicKey && registeredUsername && identity) {
                const st = isActive ? "read" : "delivered";
                await sendReceipt(c, [msgId], st);
            }
            if (!c.publicKey && socket?.readyState === WebSocket.OPEN) {
                socket.send(JSON.stringify({ type: "user.lookup", username: c.name }));
            }

            if (isActive) renderMessages();
            renderContacts();
            return;
        }

        if (data.type === "message.receipt") {
            try {
                const d = await decryptWith(identity.encKeyPair.privateKey, data.data);
                const { payload, signature, sigPublicKey } = d;
                const peer = contactMap.get(String(data.from).toLowerCase());
                if (peer?.sigPublicKey && peer.sigPublicKey !== sigPublicKey) {
                    console.warn("receipt sig key mismatch"); return;
                }
                const ok = await verify(sigPublicKey, payload, signature);
                if (!ok) { console.warn("invalid receipt signature"); return; }

                const order = { pending: 0, sent: 1, delivered: 2, read: 3, failed: -1 };
                const ids = Array.isArray(payload.messageIds) ? payload.messageIds : [payload.messageId];
                let touchedConv = null;
                for (const id of ids) {
                    const stored = await dbGet("messages", id);
                    if (!stored) continue;
                    if ((order[payload.status] ?? 0) > (order[stored.status] ?? 0)) {
                        stored.status = payload.status;
                        await saveMessage(stored);
                        const cc = contactMap.get(stored.conversationId);
                        if (cc) {
                            const m = cc.messages.find(x => x.id === id);
                            if (m) m.status = payload.status;
                        }
                        touchedConv = stored.conversationId;
                    }
                }
                if (touchedConv && activeId === touchedConv) renderMessages();
            } catch (e) { console.warn("receipt failed:", e); }
            return;
        }

        if (data.type === "message.ack") {
            const stored = await dbGet("messages", data.id);
            if (!stored || stored.status !== "pending") return;
            stored.status = "sent";
            await saveMessage(stored);
            const cc = contactMap.get(stored.conversationId);
            if (cc) {
                const m = cc.messages.find(x => x.id === data.id);
                if (m) m.status = "sent";
            }
            if (activeId === stored.conversationId) renderMessages();
            return;
        }

        if (data.type === "message.blocked" || data.type === "message.failed") {
            const stored = await dbGet("messages", data.id);
            if (!stored) return;
            stored.status = "failed";
            await saveMessage(stored);
            const contact = contactMap.get(stored.conversationId);
            const message = contact?.messages.find(item => item.id === data.id);
            if (message) message.status = "failed";
            if (activeId === stored.conversationId) renderMessages();
            showUsernameStatus(data.error || "Message not sent: this chat is blocked");
            return;
        }

        if (data.type === "error") console.warn("Server error:", data.error);
    }

    // ============================================================
    // Envío
    // ============================================================
    async function sendMessage(text) {
        if (new TextEncoder().encode(text).byteLength > MAX_MESSAGE_BYTES) {
            showUsernameStatus("Message exceeds the 2048-byte limit");
            return false;
        }
        if (requireUsername()) return false;
        if (!activeId) return false;
        if (!socket || socket.readyState !== WebSocket.OPEN) {
            showUsernameStatus("Offline — message not sent");
            return false;
        }
        if (!registeredUsername) {
            showUsernameStatus("Not registered yet");
            return false;
        }
        const c = contactMap.get(activeId);
        if (!c) return false;
        if (c.deleted) {
            showUsernameStatus("This account has been deleted");
            return false;
        }
        if (c.blocked) {
            showUsernameStatus("This chat is blocked");
            return false;
        }
        if (!await requestContactLookup(c)) {
            if (c.deleted) return false;
            showPopup("Chat keys unavailable", "Could not retrieve the current encryption keys for @" + c.name + ". Please try again.");
            return false;
        }
        if (!socket || socket.readyState !== WebSocket.OPEN || !registeredUsername) {
            showUsernameStatus("Connection changed — message not sent");
            return false;
        }

        const id = crypto.randomUUID();
        const ts = Date.now();
        const payload = {
            messageId: id,
            text,
            from: registeredUsername,
            to: c.name,
            timestamp: ts,
            senderEncPublicKey: identity.encPublicKey
        };
        let signature, ciphertext;
        try {
            signature = await sign(identity.sigKeyPair.privateKey, payload);
            ciphertext = await encryptFor(c.publicKey, {
                payload, signature, sigPublicKey: identity.sigPublicKey
            });
        } catch (e) { console.error(e); return false; }

        const msg = {
            id, conversationId: c.id,
            direction: "out", text,
            timestamp: ts, status: "pending"
        };
        c.messages.push(msg);
        await saveMessage(msg);
        renderMessages(true);
        renderContacts();

        socket.send(JSON.stringify({
            type: "message.send", to: c.name, id, data: ciphertext
        }));
        return true;
    }

    // ============================================================
    // Arranque: carga persistencia y luego conecta
    // ============================================================
    async function loadPersisted() {
        const storedContacts = await dbGetAll("contacts");
        for (const sc of storedContacts) {
            contactMap.set(sc.id, {
                id: sc.id, name: sc.name,
                messages: [], online: false,
                publicKey: sc.publicKey || null,
                sigPublicKey: sc.sigPublicKey || null,
                blocked: blockedUsernames.has(String(sc.name).toLowerCase()),
                profile: sc.profile && typeof sc.profile === "object" ? sc.profile : {},
                deleted: !!sc.deleted
            });
        }
        const msgs = await dbGetAll("messages");
        msgs.sort((a, b) => a.timestamp - b.timestamp);
        for (const m of msgs) {
            let c = contactMap.get(m.conversationId);
            if (!c) c = getContact(m.conversationId, m.conversationId);
            if (m.status === "pending") {
                m.status = "failed";
                await saveMessage(m);
            }
            c.messages.push(m);
        }
    }

    // ============================================================
    // Eventos UI
    // ============================================================
    $("composer").addEventListener("submit", async (e) => {
        e.preventDefault();
        const t = input.value.trim();
        if (!t) return;
        const ok = await sendMessage(t);
        if (ok) {
            input.value = "";
            input.style.height = "auto";
        }
    });
    input.addEventListener("keydown", (e) => {
        if (enterToSend.checked && e.key === "Enter" && !e.shiftKey && !e.isComposing) {
            e.preventDefault(); $("composer").requestSubmit();
        }
    });
    input.addEventListener("input", () => {
        if (new TextEncoder().encode(input.value).byteLength > MAX_MESSAGE_BYTES) {
            let value = "", bytes = 0;
            for (const character of input.value) {
                const size = new TextEncoder().encode(character).byteLength;
                if (bytes + size > MAX_MESSAGE_BYTES) break;
                value += character;
                bytes += size;
            }
            input.value = value;
        }
        const bytes = new TextEncoder().encode(input.value).byteLength;
        const remaining = MAX_MESSAGE_BYTES - bytes;
        messageCounter.hidden = bytes < MAX_MESSAGE_BYTES - 100;
        messageCounter.textContent = `${[...input.value].length} chars · ${remaining} B left`;
        messageCounter.classList.toggle("near-limit", bytes >= MAX_MESSAGE_BYTES * 0.9 && bytes < MAX_MESSAGE_BYTES);
        messageCounter.classList.toggle("at-limit", bytes >= MAX_MESSAGE_BYTES);
        input.style.height = "auto";
        input.style.height = Math.min(input.scrollHeight, 120) + "px";
    });
    messagesEl.addEventListener("click", async (e) => {
        const button = e.target.closest("button[data-action]");
        if (!button) return;
        const bubble = button.closest(".bubble");
        const c = contactMap.get(activeId);
        const message = c?.messages.find(m => String(m.id) === bubble?.dataset.messageId);
        if (!message) return;
        if (button.dataset.action === "copy") {
            try { await navigator.clipboard.writeText(String(message.text ?? "")); }
            catch { showUsernameStatus("Clipboard access is unavailable"); }
        } else if (button.dataset.action === "remove") {
            c.messages = c.messages.filter(m => m !== message);
            try { await dbDelete("messages", message.id); } catch (err) { console.warn("message remove:", err); }
            renderMessages(); renderContacts();
        }
    });
    usernameInput.addEventListener("input", () => {
        const u = getUsername();
        usernameConfirm.hidden = !u || u === confirmedUsername;
    });

    usernameConfirm.addEventListener("click", () => {
        const u = getUsername();
        if (!u) {
            showPopup("Choose a username", "Add a username before confirming it.");
            usernameInput.focus();
            return;
        }
        const prev = registeredUsername;
        const changed = !!prev && prev.toLowerCase() !== u.toLowerCase();

        usernameInput.value = u;
        confirmedUsername = u;
        usernameConfirm.hidden = true;
        try { localStorage.setItem(STORAGE_USERNAME_KEY, u); } catch { }

        if (changed) {
            showUsernameStatus("Switching to @" + u + " — new keys will be generated…");
            identity = null;
            if (socket?.readyState === WebSocket.OPEN) {
                intentionalClose = true;
                socket.close();
            } else {
                setStatus("Reconnecting with new keys…", "");
            }
            return;
        }

        if (socket?.readyState === WebSocket.OPEN) {
            if (!registeredUsername) {
                showUsernameStatus("Username saved — registering…");
                register(u);
            } else {
                showUsernameStatus("Registered as @" + registeredUsername, true);
            }
        } else {
            showUsernameStatus("Username saved — will register on reconnect");
        }
    });

    searchInput.addEventListener("input", renderContacts);
    $("saveProfileButton").addEventListener("click", () => {
        if (!registeredUsername || socket?.readyState !== WebSocket.OPEN) {
            showPopup("Can't save profile", "Connect and register before updating your profile.");
            return;
        }
        const request = {
            type: "update.profile",
            profile: {
                displayName: profileDisplayName.value,
                bio: profileBio.value,
                avatar: profileAvatar.value
            }
        };
        if (profilePassword.value) request.password = profilePassword.value;
        socket.send(JSON.stringify(request));
    });
    $("deleteAccountButton").addEventListener("click", () => {
        if (!registeredUsername || socket?.readyState !== WebSocket.OPEN) {
            showPopup("Can't delete account", "Connect and register before deleting your account.");
            return;
        }
        if (!window.confirm("Permanently delete your account? This removes your username and queued messages and clears chats and encryption keys from this device. Other people's saved copies cannot be erased.")) return;
        socket.send(JSON.stringify({ type: "account.delete" }));
    });
    chatMenuButton.addEventListener("click", () => {
        const opening = chatMenu.hidden;
        chatMenu.hidden = !opening;
        chatMenuButton.setAttribute("aria-expanded", String(opening));
    });
    document.addEventListener("click", (event) => {
        if (!event.target.closest(".chat-menu-wrap")) {
            chatMenu.hidden = true;
            chatMenuButton.setAttribute("aria-expanded", "false");
        }
    });
    $("appearanceMenuItem").addEventListener("click", () => {
        chatMenu.hidden = true;
        chatMenuButton.setAttribute("aria-expanded", "false");
        openAppearanceDialog();
    });
    blockChatMenuItem.addEventListener("click", async () => {
        const contact = contactMap.get(activeId);
        chatMenu.hidden = true;
        chatMenuButton.setAttribute("aria-expanded", "false");
        if (!contact) return;
        if (!registeredUsername || socket?.readyState !== WebSocket.OPEN) {
            showPopup("Can't update chat block", "Connect and register before changing this chat's block.");
            return;
        }
        const action = contact.blocked ? "unblock" : "block";
        const confirmed = await confirmPopup(
            action === "block" ? "Block chat?" : "Unblock chat?",
            action === "block"
                ? `Are you sure you want to block ${contact.name}? You won't be able to send messages, and their messages won't reach you.`
                : `Are you sure you want to unblock ${contact.name}?`,
            action === "block" ? "Block chat" : "Unblock chat"
        );
        if (!confirmed) return;
        if (!registeredUsername || socket?.readyState !== WebSocket.OPEN) {
            showPopup("Chat not updated", "The connection closed before the request could be sent. Please try again.");
            return;
        }
        if (pendingContactListRequestId) {
            showPopup("Request pending", "Wait for the current block update to finish.");
            return;
        }
        const requestId = crypto.randomUUID();
        pendingContactListRequestId = requestId;
        contactListUpdateTimer = setTimeout(() => {
            if (pendingContactListRequestId !== requestId) return;
            pendingContactListRequestId = null;
            contactListUpdateTimer = null;
            showPopup("No response from server", "The block update was not confirmed. Check the connection and try again.");
        }, 10000);
        try {
            socket.send(JSON.stringify({
                type: "contact.list.update",
                requestId,
                action,
                username: contact.name
            }));
        } catch (error) {
            clearTimeout(contactListUpdateTimer);
            contactListUpdateTimer = null;
            pendingContactListRequestId = null;
            console.error("Could not send chat block update:", error);
            showPopup("Chat not updated", "The request could not be sent. Check your connection and try again.");
            return;
        }
    });
    $("appearanceClose").addEventListener("click", () => appearanceDialog.close());
    $("clearAppearance").addEventListener("click", () => {
        if (!activeId) return;
        delete chatAppearances[activeId];
        saveChatAppearances();
        updateAppearanceDialog();
        applyChatAppearance();
    });
    backgroundFit.addEventListener("change", () => {
        customCropControls.hidden = backgroundFit.value !== "custom";
        updateActiveAppearance({ fit: backgroundFit.value });
    });
    backgroundRepeat.addEventListener("change", () => updateActiveAppearance({ imageMode: backgroundRepeat.value }));
    backgroundZoom.addEventListener("input", () => {
        backgroundZoomValue.textContent = `${backgroundZoom.value}%`;
        updateActiveAppearance({ zoom: Number(backgroundZoom.value) });
    });
    cropX.addEventListener("input", () => updateActiveAppearance({ x: Number(cropX.value), fit: "custom" }));
    cropY.addEventListener("input", () => updateActiveAppearance({ y: Number(cropY.value), fit: "custom" }));
    receivedBubbleColor.addEventListener("input", () => updateActiveAppearance({ receivedBubbleColor: receivedBubbleColor.value }));
    sentBubbleColor.addEventListener("input", () => updateActiveAppearance({ sentBubbleColor: sentBubbleColor.value }));
    messageFontColor.addEventListener("input", () => updateActiveAppearance({ fontColor: messageFontColor.value }));
    chatBackgroundFile.addEventListener("change", async () => {
        const file = chatBackgroundFile.files?.[0];
        if (!file || !activeId) return;
        if (!file.type.startsWith("image/")) { showUsernameStatus("Choose an image file"); return; }
        try {
            const dataUrl = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onerror = () => reject(reader.error);
                reader.onload = () => resolve(reader.result);
                reader.readAsDataURL(file);
            });
            const image = await new Promise((resolve, reject) => {
                const img = new Image(); img.onload = () => resolve(img); img.onerror = reject; img.src = dataUrl;
            });
            const scale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight));
            const canvas = document.createElement("canvas");
            canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
            canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
            canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
            updateActiveAppearance({ background: canvas.toDataURL("image/jpeg", 0.78) });
        } catch { showUsernameStatus("Could not load that background image"); }
    });
    async function clearActiveChat() {
        const id = activeId;
        if (!id) return;
        const contact = contactMap.get(id);
        if (!contact) return;

        const messagesToClear = [...contact.messages];
        for (const message of messagesToClear) {
            try { await dbDelete("messages", message.id); } catch (error) { console.warn("clear chat message:", error); }
        }

        contact.messages = [];
        renderMessages(true);
        renderContacts();
    }

    $("clearChatMenuItem").addEventListener("click", async () => {
        const id = activeId;
        if (!id) return;
        chatMenu.hidden = true;
        chatMenuButton.setAttribute("aria-expanded", "false");
        const contact = contactMap.get(id);
        if (!window.confirm(`Clear all messages with ${contact?.name || id} from this device?`)) return;
        await clearActiveChat();
    });
    $("deleteChatMenuItem").addEventListener("click", async () => {
        const id = activeId;
        if (!id) return;
        chatMenu.hidden = true;
        chatMenuButton.setAttribute("aria-expanded", "false");
        if (!window.confirm(`Delete the chat with ${contactMap.get(id)?.name || id} and its messages from this device?`)) return;
        const contact = contactMap.get(id);
        for (const message of contact?.messages || []) {
            try { await dbDelete("messages", message.id); } catch (error) { console.warn("delete chat message:", error); }
        }
        try { await dbDelete("contacts", id); } catch (error) { console.warn("delete chat contact:", error); }
        contactMap.delete(id);
        delete chatAppearances[id];
        saveChatAppearances();
        activeId = null;
        app.classList.remove("chat-open");
        renderContacts(); renderMessages(); updateChatSubtitle(); updateComposerState();
    });
    $("backButton").addEventListener("click", () => {
        if (app.classList.contains("settings-open")) { closeSettings(); return; }
        app.classList.remove("chat-open");
        activeId = null;
        renderContacts();
        renderMessages();
        updateChatSubtitle();
        updateComposerState();
    });

    (async () => {
        if (!window.crypto || !crypto.subtle) {
            setStatus("Crypto unavailable (HTTPS required)", "offline");
            return;
        }
        try { await loadPersisted(); } catch (e) { console.warn("persist load:", e); }
        renderContacts();
        updateComposerState();
        updateChatSubtitle();
        connect();
    })();
})();