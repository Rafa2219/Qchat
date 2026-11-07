"use strict";
/**
 * Este proyecto fue creado por Rafa2219 &copy; 2026. Todos los derechos reservados.
 * Proyecto de código abierto bajo la licencia MIT. Para más información, consulte el archivo LICENSE.
 * 
 * Este servidor de mensajería utiliza WebSockets para la comunicación en tiempo real.
 */
const WebSocket = require("ws");
const { Server } = WebSocket;
const crypto = require("node:crypto");
const console = require("node:console");
const { MongoClient } = require("mongodb");
const { promisify } = require("node:util");
const {
    db,
    uuidToBinary,
    binaryToUuid,
    intializeDatabase,
    addQuedque,
    hasPendingMessages,
    getPendingMessages,
    markMessagesAsDelivered
} = require("./database/SQLite");
require("dotenv").config();

const PORT = process.env.MSG_PORT || 3736;
const configuredMaxMessageLength = Number(process.env.MAX_MESSAGE_LENGTH);
const MAX_MESSAGE_LENGTH = Number.isSafeInteger(configuredMaxMessageLength) && configuredMaxMessageLength > 0
    ? configuredMaxMessageLength
    : 2048;
const io = new Server({ port: PORT });
const mongoClient = process.env.MONGODB_URI ? new MongoClient(process.env.MONGODB_URI) : null;
let blockedUsersCollection = null;
let deletedUsersCollection = null;
const profilesByUsername = new Map();
const deletedUsernames = new Set();
const deletingUsernames = new Set();
const scrypt = promisify(crypto.scrypt);

const mongoReady = mongoClient
    ? mongoClient.connect()
        .then(async () => {
            const db = mongoClient.db(process.env.MONGODB_DB || "qchat");
            blockedUsersCollection = db.collection("users");
            deletedUsersCollection = db.collection("deletedUsers");
            const [profiles, deleted] = await Promise.all([
                blockedUsersCollection.find({}).toArray(),
                deletedUsersCollection.find({}, { projection: { _id: 1 } }).toArray()
            ]);
            for (const profile of profiles) {
                const username = profile.usernameLower || profile.username;
                if (typeof username === "string") profilesByUsername.set(username.toLowerCase(), profile);
            }
            for (const user of deleted) {
                const username = user.usernameLower || user.username;
                if (typeof username === "string") deletedUsernames.add(username.toLowerCase());
            }
            console.log(`MongoDB connected; loaded ${profiles.length} accounts and ${deleted.length} deleted usernames.`);
            return true;
        })
        .catch((error) => {
            console.error("MongoDB connection or account loading failed:", error);
            return false;
        })
    : Promise.resolve(false);

io.on("listening", () => {
    console.log("server listening at: ws://localhost:" + PORT);
});

//  estado 
const sessions = new Map(); // sessionId : { socket }
const users = new Map(); // sessionId : { username, encPublicKey, sigPublicKey }
const usernameIndex = new Map(); // lower(username) : { sessionId, username, encPublicKey, sigPublicKey }
const pendingVerifications = new Map(); // sessionId : { username, encPublicKey, sigPublicKey, challenge }
const registeringUsernames = new Set();
const offlineQueue = new Map(); // lower(username) : [envelope]
const contacts = new Map(); // socketId : Set<socketId>

//  helpers 
function sendError(socket, message) {
    try { socket.send(JSON.stringify({ type: "error", from: "server", error: message })); } catch { }
}
const debug = process.env.DEBUG === "true" ? console.log : () => { };
const debugls = process.env.DEBUG === "true" ? (cond, ...dat) => {
    if (!process.env[cond]) return;
    console.log(...dat);
} : () => {};
function normalizeUsername(u) {
    if (typeof u !== "string") return null;
    const t = u.trim().replace(/^@/, "");
    if (t.length < 2 || t.length > 30) return null;
    if (!/^[a-zA-Z0-9_.-]+$/.test(t)) return null;
    return t;
}

function findSocketIdByUsername(username) {
    if (typeof username !== "string") return null;
    return usernameIndex.get(username.toLowerCase())?.sessionId || null;
}

function sendUserDeleted(socket, username, id, requestId) {
    socket.send(JSON.stringify({
        type: "user.deleted",
        from: "server",
        username,
        id,
        requestId: typeof requestId === "string" ? requestId : undefined
    }));
}

function notifyUserKeyChange(username, encPublicKey, sigPublicKey, excludeSessionId) {
    const update = JSON.stringify({
        type: "user.keys.updated",
        from: "server",
        username,
        publicKey: encPublicKey,
        sigPublicKey
    });
    for (const [sessionId, user] of users) {
        if (sessionId === excludeSessionId || user.username.toLowerCase() === username.toLowerCase()) continue;
        const session = sessions.get(sessionId);
        if (session?.socket.readyState === WebSocket.OPEN) session.socket.send(update);
    }
}

function sendContactListUpdateResult(socket, meta, data) {
    socket.send(JSON.stringify({
        type: "contact.list.update.result",
        requestId: typeof meta.requestId === "string" ? meta.requestId : undefined,
        from: "server",
        data
    }));
}

function getOnlineUsernames(excludeSessionId) {
    const set = new Set();
    for (const [sessionId, u] of users) {
        if (sessionId === excludeSessionId) continue;
        if (typeof u.username === "string") set.add(u.username);
    }
    return [...set];
}

function sendOnlineUsers() {
    for (const [sessionId, session] of sessions) {
        if (session.socket.readyState !== WebSocket.OPEN) continue;
        session.socket.send(JSON.stringify({
            type: "users.online.result",
            from: "server",
            data: { users: getOnlineUsernames(sessionId) }
        }));
    }
}

function verifySignature(sigPublicKeyB64, dataBuf, signatureB64) {
    const spki = Buffer.from(sigPublicKeyB64, "base64");
    const key = crypto.createPublicKey({ key: spki, format: "der", type: "spki" });
    return crypto.verify(
        "sha256",
        dataBuf,
        { key, dsaEncoding: "ieee-p1363" },   // WebCrypto devuelve r||s, no DER
        Buffer.from(signatureB64, "base64")
    );
}

function flushOfflineQueue(sessionId, username) {
    const lower = username.toLowerCase();
    const q = offlineQueue.get(lower);
    if (!q || !q.length) return;
    const sock = sessions.get(sessionId)?.socket;
    if (!sock || sock.readyState !== WebSocket.OPEN) return;
    for (const env of q) sock.send(JSON.stringify(env));
    offlineQueue.delete(lower);
}

async function updateContactList(socket, username, meta) {
    const target = normalizeUsername(meta.username);
    if (!target) {
        return sendContactListUpdateResult(socket, meta, {
            success: false, error: "Nombre de usuario inválido."
        });
    }
    if (target.toLowerCase() === username.toLowerCase()) {
        return sendContactListUpdateResult(socket, meta, {
            success: false, error: "No puedes bloquearte a ti mismo."
        });
    }
    if (meta.action !== "block" && meta.action !== "unblock") {
        return sendContactListUpdateResult(socket, meta, {
            success: false, error: "Acción de lista no válida."
        });
    }
    if (!mongoClient || !await mongoReady || !blockedUsersCollection) {
        return sendContactListUpdateResult(socket, meta, {
            success: false, error: "El bloqueo de chats no está disponible."
        });
    }

    try {
        const owner = username.toLowerCase();
        const blocked = target.toLowerCase();
        if (meta.action === "block") {
            await blockedUsersCollection.updateOne(
                { usernameLower: owner },
                {
                    $setOnInsert: { username, usernameLower: owner },
                    $addToSet: { blockedUsers: blocked }
                },
                { upsert: true }
            );
            const queued = offlineQueue.get(owner);
            if (queued) {
                const remaining = queued.filter((envelope) => envelope.from.toLowerCase() !== blocked);
                if (remaining.length) offlineQueue.set(owner, remaining);
                else offlineQueue.delete(owner);
            }
        } else {
            await blockedUsersCollection.updateOne(
                { usernameLower: owner },
                { $pull: { blockedUsers: blocked } }
            );
        }
        const account = profilesByUsername.get(owner);
        if (account) {
            const list = Array.isArray(account.blockedUsers) ? account.blockedUsers : [];
            account.blockedUsers = meta.action === "block"
                ? [...new Set([...list, blocked])]
                : list.filter((username) => username !== blocked);
        }
        return sendContactListUpdateResult(socket, meta, {
            success: true, action: meta.action, username: target
        });
    } catch (error) {
        console.error("Failed to save blocked chat:", error);
        return sendContactListUpdateResult(socket, meta, {
            success: false, error: "No se pudo guardar el bloqueo."
        });
    }
}

function getPublicProfile(profile) {
    return profile?.profile && typeof profile.profile === "object"
        ? profile.profile
        : { displayName: "", bio: "", avatar: "" };
}

async function updateProfile(socket, username, meta) {
    if (!mongoClient || !await mongoReady || !blockedUsersCollection) {
        return socket.send(JSON.stringify({
            type: "update.profile.result",
            data: { success: false, error: "Profile storage is unavailable." }
        }));
    }

    const profile = meta.profile;
    if (!profile || typeof profile !== "object" || Array.isArray(profile)) {
        return socket.send(JSON.stringify({
            type: "update.profile.result",
            data: { success: false, error: "Invalid profile." }
        }));
    }

    const updatedProfile = { ...getPublicProfile(profilesByUsername.get(username.toLowerCase())) };
    if (Object.hasOwn(profile, "displayName")) {
        if (typeof profile.displayName !== "string" || profile.displayName.length > 50) {
            return socket.send(JSON.stringify({
                type: "update.profile.result",
                data: { success: false, error: "Display name must be 50 characters or fewer." }
            }));
        }
        updatedProfile.displayName = profile.displayName.trim();
    }
    if (Object.hasOwn(profile, "bio")) {
        if (typeof profile.bio !== "string" || profile.bio.length > 160) {
            return socket.send(JSON.stringify({
                type: "update.profile.result",
                data: { success: false, error: "Bio must be 160 characters or fewer." }
            }));
        }
        updatedProfile.bio = profile.bio.trim();
    }
    if (Object.hasOwn(profile, "avatar")) {
        if (typeof profile.avatar !== "string" || profile.avatar.length > 2048) {
            return socket.send(JSON.stringify({
                type: "update.profile.result",
                data: { success: false, error: "Avatar URL must be 2048 characters or fewer." }
            }));
        }
        if (profile.avatar) {
            let avatarUrl;
            try { avatarUrl = new URL(profile.avatar); }
            catch {
                return socket.send(JSON.stringify({
                    type: "update.profile.result",
                    data: { success: false, error: "Avatar must be a valid HTTP(S) URL." }
                }));
            }
            if (!["http:", "https:"].includes(avatarUrl.protocol)) {
                return socket.send(JSON.stringify({
                    type: "update.profile.result",
                    data: { success: false, error: "Avatar must be a valid HTTP(S) URL." }
                }));
            }
        }
        updatedProfile.avatar = profile.avatar.trim();
    }

    const fields = { profile: updatedProfile };
    if (typeof meta.password === "string" && meta.password) {
        if (meta.password.length < 12 || meta.password.length > 128) {
            return socket.send(JSON.stringify({
                type: "update.profile.result",
                data: { success: false, error: "Password must be 12-128 characters." }
            }));
        }
        const salt = crypto.randomBytes(16);
        const hash = await scrypt(meta.password, salt, 64);
        fields.passwordCredential = {
            algorithm: "scrypt",
            salt: salt.toString("base64"),
            hash: hash.toString("base64")
        };
    }

    try {
        await blockedUsersCollection.updateOne(
            { usernameLower: username.toLowerCase() },
            { $set: fields }
        );
        const stored = profilesByUsername.get(username.toLowerCase()) || { _id: username.toLowerCase(), username };
        stored.profile = updatedProfile;
        if (fields.passwordCredential) stored.passwordCredential = fields.passwordCredential;
        profilesByUsername.set(username.toLowerCase(), stored);
        return socket.send(JSON.stringify({
            type: "update.profile.result",
            data: { success: true, profile: updatedProfile }
        }));
    } catch (error) {
        console.error("Failed to update profile:", error);
        return socket.send(JSON.stringify({
            type: "update.profile.result",
            data: { success: false, error: "Could not save profile." }
        }));
    }
}

async function deleteAccount(socket, username) {
    if (!mongoClient || !await mongoReady || !blockedUsersCollection || !deletedUsersCollection) {
        return socket.send(JSON.stringify({
            type: "account.delete.result",
            data: { success: false, error: "Account storage is unavailable." }
        }));
    }

    const lower = username.toLowerCase();
    deletingUsernames.add(lower);
    try {
        await deletedUsersCollection.updateOne(
            { usernameLower: lower },
            { $set: { username, usernameLower: lower } },
            { upsert: true }
        );
        await blockedUsersCollection.deleteOne({ usernameLower: lower });
        await blockedUsersCollection.updateMany(
            { blockedUsers: lower },
            { $pull: { blockedUsers: lower } }
        );
    } catch (error) {
        deletingUsernames.delete(lower);
        console.error("Failed to delete account from MongoDB:", error);
        return socket.send(JSON.stringify({
            type: "account.delete.result",
            data: { success: false, error: "Could not delete the account." }
        }));
    }

    deletedUsernames.add(lower);
    deletingUsernames.delete(lower);
    profilesByUsername.delete(lower);
    offlineQueue.delete(lower);
    for (const [recipient, queue] of offlineQueue) {
        const remaining = queue.filter((envelope) => envelope.from.toLowerCase() !== lower);
        if (remaining.length) offlineQueue.set(recipient, remaining);
        else offlineQueue.delete(recipient);
    }

    const socketsToClose = [];
    for (const [id, pending] of pendingVerifications) {
        if (pending.username.toLowerCase() !== lower) continue;
        const session = sessions.get(id);
        if (session) socketsToClose.push(session.socket);
        pendingVerifications.delete(id);
    }
    for (const [id, user] of users) {
        if (user.username.toLowerCase() !== lower) continue;
        const session = sessions.get(id);
        if (session) socketsToClose.push(session.socket);
        users.delete(id);
        contacts.delete(id);
        pendingVerifications.delete(id);
        for (const contactSet of contacts.values()) contactSet.delete(id);
    }
    usernameIndex.delete(lower);
    const response = {
        type: "account.delete.result",
        data: { success: true }
    };
    socket.send(JSON.stringify(response), () => {
        for (const socketToClose of socketsToClose) {
            try { socketToClose.close(1000, "Account deleted"); }
            catch (error) { console.error("Could not close deleted account session:", error); }
        }
        sendOnlineUsers();
    });
}

//  registro (auth) 
async function handleRegister(socket, sessionId, meta) {
    if (mongoClient && !await mongoReady) {
        return socket.send(JSON.stringify({ type: "register.error", error: "Account storage is unavailable." }));
    }
    const username = normalizeUsername(meta.username);
    if (!username) return sendError(socket, "Username inválido (2-30 chars: a-z 0-9 _ . -).");
    if (typeof meta.encPublicKey !== "string" || typeof meta.sigPublicKey !== "string")
        return sendError(socket, "Faltan encPublicKey o sigPublicKey.");

    const lower = username.toLowerCase();
    const existing = usernameIndex.get(lower);

    if (existing) {
        if (existing.encPublicKey !== meta.encPublicKey || existing.sigPublicKey !== meta.sigPublicKey) {
            return socket.send(JSON.stringify({
                type: "register.error",
                error: "Ese username ya está registrado con otras llaves."
            }));
        }
    }
    const challenge = crypto.randomBytes(32).toString("base64");
    pendingVerifications.set(sessionId, {
        username,
        encPublicKey: meta.encPublicKey,
        sigPublicKey: meta.sigPublicKey,
        challenge
    });
    socket.send(JSON.stringify({ type: "register.challenge", challenge }));
}

async function handleVerify(socket, sessionId, meta) {
    const pending = pendingVerifications.get(sessionId);
    if (!pending) return sendError(socket, "No hay un registro pendiente.");
    if (typeof meta.signature !== "string") return sendError(socket, "Falta la firma.");

    let ok = false;
    try {
        ok = verifySignature(
            pending.sigPublicKey,
            Buffer.from(pending.challenge, "base64"),
            meta.signature
        );
    } catch { ok = false; }

    if (!ok) {
        pendingVerifications.delete(sessionId);
        return socket.send(JSON.stringify({ type: "register.error", error: "Firma inválida." }));
    }

    const lower = pending.username.toLowerCase();
    const previous = usernameIndex.get(lower);
    let blockedUsers;
    const savedAccount = profilesByUsername.get(lower);
    if (previous && previous.sessionId !== sessionId &&
        (previous.encPublicKey !== pending.encPublicKey || previous.sigPublicKey !== pending.sigPublicKey)) {
        pendingVerifications.delete(sessionId);
        return socket.send(JSON.stringify({
            type: "register.error",
            error: "Ese username ya está en uso."
        }));
    }
    if (registeringUsernames.has(lower)) {
        pendingVerifications.delete(sessionId);
        return socket.send(JSON.stringify({
            type: "register.error",
            error: "Ese username ya se está registrando."
        }));
    }
    registeringUsernames.add(lower);
    const wasDeleted = deletedUsernames.has(lower);
    const keysChanged = wasDeleted || !!(savedAccount &&
        ((savedAccount.encPublicKey && savedAccount.encPublicKey !== pending.encPublicKey) ||
            (savedAccount.sigPublicKey && savedAccount.sigPublicKey !== pending.sigPublicKey)));
    if (mongoClient && await mongoReady && blockedUsersCollection) {
        try {
            if (wasDeleted) await blockedUsersCollection.deleteOne({ usernameLower: lower });
            await blockedUsersCollection.updateOne(
                { usernameLower: lower },
                {
                    $setOnInsert: {
                        usernameLower: lower,
                        blockedUsers: [],
                        profile: { displayName: "", bio: "", avatar: "" }
                    },
                    $set: {
                        username: pending.username,
                        encPublicKey: pending.encPublicKey,
                        sigPublicKey: pending.sigPublicKey
                    }
                },
                { upsert: true }
            );
            const user = await blockedUsersCollection.findOne({ usernameLower: lower });
            if (wasDeleted) {
                await deletedUsersCollection.deleteOne({ usernameLower: lower });
                deletedUsernames.delete(lower);
                deletingUsernames.delete(lower);
            }
            profilesByUsername.set(lower, user);
            blockedUsers = Array.isArray(user?.blockedUsers) ? user.blockedUsers : [];
        } catch (error) {
            registeringUsernames.delete(lower);
            console.error("Failed to load account data:", error);
            pendingVerifications.delete(sessionId);
            return socket.send(JSON.stringify({ type: "register.error", error: "Could not load account data." }));
        }
    } else if (mongoClient) {
        registeringUsernames.delete(lower);
        pendingVerifications.delete(sessionId);
        return socket.send(JSON.stringify({ type: "register.error", error: "Account storage is unavailable." }));
    }

    users.set(sessionId, {
        username: pending.username,
        encPublicKey: pending.encPublicKey,
        sigPublicKey: pending.sigPublicKey
    });
    usernameIndex.set(lower, {
        sessionId,
        username: pending.username,
        encPublicKey: pending.encPublicKey,
        sigPublicKey: pending.sigPublicKey
    });
    registeringUsernames.delete(lower);
    if (!contacts.has(sessionId)) contacts.set(sessionId, new Set());
    pendingVerifications.delete(sessionId);

    if (previous && previous.sessionId !== sessionId) {
        const old = sessions.get(previous.sessionId)?.socket;
        if (old) { try { old.close(); } catch { } }
    }

    socket.send(JSON.stringify({
        type: "register.ok",
        username: pending.username,
        blockedUsers,
        profile: getPublicProfile(profilesByUsername.get(lower))
    }), () => {
        if (keysChanged) {
            notifyUserKeyChange(pending.username, pending.encPublicKey, pending.sigPublicKey, sessionId);
        }
        sendOnlineUsers();
        flushOfflineQueue(sessionId, pending.username);
    });
}

//  conexión 
io.on("connection", (socket) => {
    const sessionId = crypto.randomUUID();
    sessions.set(sessionId, { socket, sessionId });
    console.log("new connection: " + sessionId);

    socket.send(JSON.stringify({
        type: "hello",
        sessionId,
        message: "your session id is: " + sessionId
    }));

    socket.on("message", async (data) => {
        const messageLength = Buffer.isBuffer(data)
            ? data.length
            : Array.isArray(data)
                ? data.reduce((length, chunk) => length + chunk.length, 0)
                : data.byteLength;
        console.log(messageLength, MAX_MESSAGE_LENGTH);
        if (messageLength > MAX_MESSAGE_LENGTH) {
            return sendError(socket, `El mensaje excede el máximo de ${MAX_MESSAGE_LENGTH} bytes.`);
        }

        let meta;
        try {
            meta = JSON.parse(data.toString("utf-8"));
            debug("Request received:", { type: meta?.type });
            debugls("meta", meta);
        }
        catch { return sendError(socket, "JSON inválido."); }
        if (!meta || typeof meta !== "object") return sendError(socket, "Payload inválido.");

        // --- endpoints sin auth ---
        if (meta.type === "register.presence") {
            return handleRegister(socket, sessionId, meta).catch((error) => {
                console.error("Registration failed:", error);
                socket.send(JSON.stringify({ type: "register.error", error: "Could not complete registration." }));
            });
        }
        if (meta.type === "register.verify") {
            return handleVerify(socket, sessionId, meta).catch((error) => {
                console.error("Registration verification failed:", error);
                sendError(socket, "No se pudo completar el registro.");
            });
        }

        // --- todo lo demás requiere estar registrado ---
        const me = users.get(sessionId);
        if (!me) return sendError(socket, "Debes registrarte primero.");

        if (meta.type === "users.online") {
            return socket.send(JSON.stringify({
                type: "users.online.result",
                from: "server",
                data: { users: getOnlineUsernames(sessionId) }
            }));
        }

        if (meta.type === "user.lookup") {
            const username = normalizeUsername(meta.username);
            const lower = username?.toLowerCase();
            if (!username) return socket.send(JSON.stringify({
                type: "user.lookup.result",
                from: "server",
                requestId: typeof meta.requestId === "string" ? meta.requestId : undefined,
                data: { success: false, error: "Usuario no encontrado." }
            }));
            if (deletedUsernames.has(lower) || deletingUsernames.has(lower)) {
                return sendUserDeleted(socket, username, undefined, meta.requestId);
            }
            const target = findSocketIdByUsername(username);
            const u = target ? users.get(target) : profilesByUsername.get(lower);
            if (!u) return socket.send(JSON.stringify({
                type: "user.lookup.result",
                from: "server",
                requestId: typeof meta.requestId === "string" ? meta.requestId : undefined,
                data: { success: false, error: "Usuario no encontrado." }
            }));
            return socket.send(JSON.stringify({
                type: "user.lookup.result",
                from: "server",
                requestId: typeof meta.requestId === "string" ? meta.requestId : undefined,
                data: {
                    success: true,
                    user: {
                        username: u.username,
                        publicKey: u.encPublicKey,
                        sigPublicKey: u.sigPublicKey,
                        profile: getPublicProfile(profilesByUsername.get(lower))
                    }
                }
            }));
        }

        if (meta.type === "contact.add") {
            const username = normalizeUsername(meta.username);
            if (username && (deletedUsernames.has(username.toLowerCase()) ||
                deletingUsernames.has(username.toLowerCase()))) return sendUserDeleted(socket, username);
            const target = findSocketIdByUsername(username);
            if (!target) return socket.send(JSON.stringify({
                type: "contact.add.result",
                from: "server",
                data: { success: false, error: "Usuario no encontrado." }
            }));
            if (target === sessionId) return sendError(socket, "No puedes agregarte a ti mismo.");
            contacts.get(sessionId)?.add(target);
            contacts.get(target)?.add(socket_id);
            const u = users.get(target);
            return socket.send(JSON.stringify({
                type: "contact.add.result",
                from: "server",
                data: {
                    success: true,
                    user: {
                        username: u.username,
                        publicKey: u.encPublicKey,
                        sigPublicKey: u.sigPublicKey,
                        profile: getPublicProfile(profilesByUsername.get(u.username.toLowerCase()))
                    }
                }
            }));
        }

        if (meta.type === "contact.list.update") return updateContactList(socket, me.username, meta);
        if (meta.type === "update.profile") {
            return updateProfile(socket, me.username, meta).catch((error) => {
                console.error("Profile update failed:", error);
                socket.send(JSON.stringify({
                    type: "update.profile.result",
                    data: { success: false, error: "Could not save profile." }
                }));
            });
        }
        if (meta.type === "account.delete") return deleteAccount(socket, me.username);

        if (meta.type === "message.send") {
            const to = normalizeUsername(meta.to);
            if (!to) return sendError(socket, "Falta 'to'.");
            if (typeof meta.data !== "string" || !meta.data) return sendError(socket, "Falta 'data' cifrada.");

            const envelope = {
                type: "message.receive",
                from: me.username,
                to,
                id: typeof meta.id === "string" ? meta.id : crypto.randomUUID(),
                timestamp: Date.now(),
                data: meta.data
            };

            if (deletedUsernames.has(to.toLowerCase()) || deletingUsernames.has(to.toLowerCase())) {
                return sendUserDeleted(socket, to, envelope.id);
            }

            if (mongoClient) {
                if (!blockedUsersCollection) {
                    return socket.send(JSON.stringify({
                        type: "message.failed",
                        id: envelope.id,
                        error: "El servicio de bloqueo no está disponible; no se envió el mensaje."
                    }));
                }
                try {
                    const sender = me.username.toLowerCase();
                    const recipient = to.toLowerCase();
                    const blocked = await blockedUsersCollection.findOne({
                        $or: [
                            { usernameLower: recipient, blockedUsers: sender },
                            { usernameLower: sender, blockedUsers: recipient }
                        ]
                    }, { projection: { _id: 1 } });
                    if (blocked) {
                        return socket.send(JSON.stringify({
                            type: "message.blocked",
                            id: envelope.id
                        }));
                    }
                } catch (error) {
                    console.error("Failed to check chat block list:", error);
                    return socket.send(JSON.stringify({
                        type: "message.failed",
                        id: envelope.id,
                        error: "No se pudo verificar el bloqueo; no se envió el mensaje."
                    }));
                }
            }

            const targetSocketId = findSocketIdByUsername(to);
            const targetSock = targetSocketId ? sessions.get(targetSocketId)?.socket : null;



            if (targetSock && targetSock.readyState === WebSocket.OPEN) {
                targetSock.send(JSON.stringify(envelope));
                return socket.send(JSON.stringify({
                    type: "message.ack", id: envelope.id, delivered: true
                }));
            }

            // cola offline (solo admite hasta 200) ¿sera mas lento si uso la base de datos? tambien se podta usar SQLite...
            const lower = to.toLowerCase();
            
            const q = offlineQueue.get(lower) || [];
            q.push(envelope);
            if (q.length > 200) q.shift();
            offlineQueue.set(lower, q);
            // agregar a la cola.
            //await addQuedque()
            return socket.send(JSON.stringify({
                type: "message.ack", id: envelope.id, delivered: false
            }));
        }
        if (meta.type === "message.receipt") {
            const to = normalizeUsername(meta.to);
            if (!to || typeof meta.data !== "string") return sendError(socket, "Receipt inválido.");

            const envelope = {
                type: "message.receipt",
                from: me.username,
                to,
                data: meta.data
            };

            if (deletedUsernames.has(to.toLowerCase()) || deletingUsernames.has(to.toLowerCase())) {
                return sendUserDeleted(socket, to);
            }
            const targetSocketId = findSocketIdByUsername(to);
            const targetSock = targetSocketId ? sessions.get(targetSocketId)?.socket : null;

            if (targetSock && targetSock.readyState === WebSocket.OPEN) {
                targetSock.send(JSON.stringify(envelope));
                return;
            }
            const lower = to.toLowerCase();
            const q = offlineQueue.get(lower) || [];
            q.push(envelope);
            if (q.length > 200) q.shift();
            offlineQueue.set(lower, q);
            return;
        }

        return sendError(socket, "Método no válido: " + meta.type);
    });

    socket.on("close", () => {
        console.log("Connection closed: " + sessionId);
        const user = users.get(sessionId);
        sessions.delete(sessionId);
        users.delete(sessionId);
        contacts.delete(sessionId);
        pendingVerifications.delete(sessionId);

        if (user?.username) {
            const lower = user.username.toLowerCase();
            // no borrar la entrada si ya la reemplazó un socket nuevo (reconexión)
            if (usernameIndex.get(lower)?.sessionId === sessionId) {
                usernameIndex.delete(lower);
            }
        }
        for (const set of contacts.values()) set.delete(sessionId);
        sendOnlineUsers();
    });
});

io.on("error", (error) => {
    console.log("Server error:", error);
});