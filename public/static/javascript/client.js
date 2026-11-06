
(() => {
    // ============================================================
    // Config
    // ============================================================
    const SOCKET_URL = "wss://message.antakim.uk";
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
    const appearanceDialog = $("appearanceDialog");
    const chatMenuButton = $("chatMenuButton");
    const chatMenu = $("chatMenu");
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
    let activeId = null;
    let socket = null;
    let identity = null;
    let registeredUsername = null;
    let reconnectTimer = null;
    let presenceTimer = null;
    let pendingContactId = null;
    let retryDelay = 1000;
    let intentionalClose = false;
    const CHAT_APPEARANCE_KEY = "uassapp-chat-appearance";
    let chatAppearances = (() => { try { return JSON.parse(localStorage.getItem(CHAT_APPEARANCE_KEY) || "{}"); } catch { return {}; } })();

    function saveChatAppearances() {
        try { localStorage.setItem(CHAT_APPEARANCE_KEY, JSON.stringify(chatAppearances)); }
        catch { showUsernameStatus("Could not save chat appearance — image may be too large"); }
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
    const getUsername = () => normalizeUsername(usernameInput.value);
    let confirmedUsername = getUsername();
    function getSavedUsername() {
        try { return normalizeUsername(localStorage.getItem(STORAGE_USERNAME_KEY)); }
        catch { return ""; }
    }
    function showPopup(title, message, continueToChat = false) {
        popupTitle.textContent = title;
        popupMessage.textContent = message;
        popupContinue.hidden = !continueToChat;
        const usernameToRestore = registeredUsername || getSavedUsername() || confirmedUsername;
        popupContinue.textContent = usernameToRestore
            ? `Continue as @${usernameToRestore}` : "Continue to chat";
        if (!appPopup.open) appPopup.showModal();
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
    $("popupClose").addEventListener("click", () => appPopup.close());
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
        if (!activeId) {
            activeSubtitle.textContent = "Messages are sent over a secure connection";
            return;
        }
        const c = contactMap.get(activeId);
        if (!c) return;
        if (socket?.readyState !== WebSocket.OPEN) {
            activeSubtitle.textContent = "You're offline — reconnecting…";
            return;
        }
        if (!registeredUsername) {
            activeSubtitle.textContent = "Registering…";
            return;
        }
        activeSubtitle.textContent = c.online ? "online" : "last seen recently";
    }

    function updateComposerState() {
        const connected = socket?.readyState === WebSocket.OPEN;
        const registered = !!registeredUsername;
        const canDraft = !!activeId;
        input.disabled = !canDraft;
        sendButton.disabled = !(connected && registered && canDraft);
        if (!canDraft) input.placeholder = "Select a chat to message";
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
                publicKey: null, sigPublicKey: null
            });
        }
        const c = contactMap.get(key);
        if (name) c.name = String(name);
        return c;
    }
    async function saveContact(c) {
        await dbPut("contacts", {
            id: c.id, name: c.name,
            publicKey: c.publicKey, sigPublicKey: c.sigPublicKey
        });
    }
    async function saveMessage(m) { await dbPut("messages", m); }

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
        } else c.messages.forEach(m => messagesEl.append(makeBubble(m)));
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
            .filter(c => c.name.toLowerCase().includes(q))
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
            av.textContent = c.name.trim().charAt(0).toUpperCase() || "?";
            const info = document.createElement("span");
            info.className = "contact-info";
            const nm = document.createElement("span");
            nm.className = "contact-name"; nm.textContent = c.name;
            const pv = document.createElement("span");
            pv.className = "preview";
            const last = c.messages.at(-1);
            pv.textContent = last ? String(last.text ?? "") : "Start a conversation";
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
        activeId = id;
        const c = contactMap.get(id);
        activeName.textContent = c.name;
        activeAvatar.textContent = c.name.trim().charAt(0).toUpperCase() || "?";
        applyChatAppearance();
        document.querySelectorAll(".contact").forEach(el =>
            el.classList.toggle("active", el.dataset.id === id));
        app.classList.add("chat-open");
        renderMessages(true);
        updateChatSubtitle();
        updateComposerState();
        if (autoFocus.checked && window.matchMedia("(min-width: 701px)").matches) input.focus();
        if (!c.publicKey && socket?.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type: "user.lookup", username: c.name }));
        }
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
                getContact(u, u).online = true;
            }
            renderContacts();
            updateChatSubtitle();
            return;
        }
        if (data.type === "user.lookup.result" || data.type === "contact.add.result") {
            const d = data.data || {};
            if (d.success && d.user?.username) {
                const c = getContact(d.user.username, d.user.username);
                let changed = false;
                if (d.user.publicKey && c.publicKey !== d.user.publicKey) { c.publicKey = d.user.publicKey; changed = true; }
                if (d.user.sigPublicKey && c.sigPublicKey !== d.user.sigPublicKey) { c.sigPublicKey = d.user.sigPublicKey; changed = true; }
                if (changed) saveContact(c);
                renderContacts();
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
                            if (!c.sigPublicKey) { c.sigPublicKey = sigPublicKey; await saveContact(c); }
                            text = (c.sigPublicKey === sigPublicKey)
                                ? payload.text
                                : "[⚠ la llave del remitente cambió] " + payload.text;
                            ts = payload.timestamp || ts;
                            senderEncPub = payload.senderEncPublicKey || null;
                            verified = true;
                            if (!c.publicKey && senderEncPub) {
                                c.publicKey = senderEncPub;
                                await saveContact(c);
                            }
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
        if (!c.publicKey) {
            socket.send(JSON.stringify({ type: "user.lookup", username: c.name }));
            showPopup("Still connecting", "We don't have " + c.name + "’s public key yet. Please try again in a moment.");
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
                sigPublicKey: sc.sigPublicKey || null
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