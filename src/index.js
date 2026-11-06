"use strict";
const WebSocket = require("ws");
const { Server } = WebSocket;
const crypto = require("node:crypto");
const console = require("node:console");
require("dotenv").config();

const PORT = process.env.MSG_PORT || 3736;
const configuredMaxMessageLength = Number(process.env.MAX_MESSAGE_LENGTH);
const MAX_MESSAGE_LENGTH = Number.isSafeInteger(configuredMaxMessageLength) && configuredMaxMessageLength > 0
    ? configuredMaxMessageLength
    : 2048;
const io = new Server({ port: PORT });

io.on("listening", () => {
    console.log("server listening at: ws://localhost:" + PORT);
});

//  estado 
const sessions = new Map(); // socketId : { socket }
const users = new Map(); // socketId : { username, encPublicKey, sigPublicKey }
const usernameIndex = new Map(); // lower(username) : { socketId, username, encPublicKey, sigPublicKey }
const pendingVerifications = new Map(); // socketId : { username, encPublicKey, sigPublicKey, challenge }
const offlineQueue = new Map(); // lower(username) : [envelope]
const contacts = new Map(); // socketId : Set<socketId>

//  helpers 
function sendError(socket, message) {
    try { socket.send(JSON.stringify({ type: "error", from: "server", error: message })); } catch { }
}

function normalizeUsername(u) {
    if (typeof u !== "string") return null;
    const t = u.trim().replace(/^@/, "");
    if (t.length < 2 || t.length > 30) return null;
    if (!/^[a-zA-Z0-9_.-]+$/.test(t)) return null;
    return t;
}

function findSocketIdByUsername(username) {
    if (typeof username !== "string") return null;
    return usernameIndex.get(username.toLowerCase())?.socketId || null;
}

function getOnlineUsernames(excludeSocketId) {
    const set = new Set();
    for (const [id, u] of users) {
        if (id === excludeSocketId) continue;
        if (typeof u.username === "string") set.add(u.username);
    }
    return [...set];
}

function sendOnlineUsers() {
    for (const [sid, session] of sessions) {
        if (session.socket.readyState !== WebSocket.OPEN) continue;
        session.socket.send(JSON.stringify({
            type: "users.online.result",
            from: "server",
            data: { users: getOnlineUsernames(sid) }
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

function flushOfflineQueue(socketId, username) {
    const lower = username.toLowerCase();
    const q = offlineQueue.get(lower);
    if (!q || !q.length) return;
    const sock = sessions.get(socketId)?.socket;
    if (!sock || sock.readyState !== WebSocket.OPEN) return;
    for (const env of q) sock.send(JSON.stringify(env));
    offlineQueue.delete(lower);
}

//  registro (auth) 
function handleRegister(socket, socketId, meta) {
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
    pendingVerifications.set(socketId, {
        username,
        encPublicKey: meta.encPublicKey,
        sigPublicKey: meta.sigPublicKey,
        challenge
    });
    socket.send(JSON.stringify({ type: "register.challenge", challenge }));
}

function handleVerify(socket, socketId, meta) {
    const pending = pendingVerifications.get(socketId);
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
        pendingVerifications.delete(socketId);
        return socket.send(JSON.stringify({ type: "register.error", error: "Firma inválida." }));
    }

    const lower = pending.username.toLowerCase();
    const previous = usernameIndex.get(lower);

    users.set(socketId, {
        username: pending.username,
        encPublicKey: pending.encPublicKey,
        sigPublicKey: pending.sigPublicKey
    });
    usernameIndex.set(lower, {
        socketId,
        username: pending.username,
        encPublicKey: pending.encPublicKey,
        sigPublicKey: pending.sigPublicKey
    });
    if (!contacts.has(socketId)) contacts.set(socketId, new Set());
    pendingVerifications.delete(socketId);

    if (previous && previous.socketId !== socketId) {
        const old = sessions.get(previous.socketId)?.socket;
        if (old) { try { old.close(); } catch { } }
    }

    socket.send(JSON.stringify({
        type: "register.ok",
        username: pending.username
    }), () => {
        sendOnlineUsers();
        flushOfflineQueue(socketId, pending.username);
    });
}

//  conexión 
io.on("connection", (socket) => {
    const socket_id = crypto.randomUUID();
    sessions.set(socket_id, { socket });
    console.log("new connection: " + socket_id);

    socket.send(JSON.stringify({
        type: "hello",
        socketId: socket_id,
        message: "your id is: " + socket_id
    }));

    socket.on("message", (data) => {
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
        try { meta = JSON.parse(data.toString("utf-8")); }
        catch { return sendError(socket, "JSON inválido."); }
        if (!meta || typeof meta !== "object") return sendError(socket, "Payload inválido.");

        // --- endpoints sin auth ---
        if (meta.type === "register.presence") return handleRegister(socket, socket_id, meta);
        if (meta.type === "register.verify") return handleVerify(socket, socket_id, meta);

        // --- todo lo demás requiere estar registrado ---
        const me = users.get(socket_id);
        if (!me) return sendError(socket, "Debes registrarte primero.");

        if (meta.type === "users.online") {
            return socket.send(JSON.stringify({
                type: "users.online.result",
                from: "server",
                data: { users: getOnlineUsernames(socket_id) }
            }));
        }

        if (meta.type === "user.lookup") {
            const target = findSocketIdByUsername(meta.username);
            if (!target) return socket.send(JSON.stringify({
                type: "user.lookup.result",
                from: "server",
                data: { success: false, error: "Usuario no encontrado." }
            }));
            const u = users.get(target);
            return socket.send(JSON.stringify({
                type: "user.lookup.result",
                from: "server",
                data: {
                    success: true,
                    user: { username: u.username, publicKey: u.encPublicKey, sigPublicKey: u.sigPublicKey }
                }
            }));
        }

        if (meta.type === "contact.add") {
            const target = findSocketIdByUsername(meta.username);
            if (!target) return socket.send(JSON.stringify({
                type: "contact.add.result",
                from: "server",
                data: { success: false, error: "Usuario no encontrado." }
            }));
            if (target === socket_id) return sendError(socket, "No puedes agregarte a ti mismo.");
            contacts.get(socket_id)?.add(target);
            contacts.get(target)?.add(socket_id); 
            const u = users.get(target);
            return socket.send(JSON.stringify({
                type: "contact.add.result",
                from: "server",
                data: {
                    success: true,
                    user: { username: u.username, publicKey: u.encPublicKey, sigPublicKey: u.sigPublicKey }
                }
            }));
        }

        if (meta.type === "message.send") {
            const to = typeof meta.to === "string" ? meta.to : "";
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
            return socket.send(JSON.stringify({
                type: "message.ack", id: envelope.id, delivered: false
            }));
        }
        if (meta.type === "message.receipt") {
            const to = typeof meta.to === "string" ? meta.to : "";
            if (!to || typeof meta.data !== "string") return sendError(socket, "Receipt inválido.");

            const envelope = {
                type: "message.receipt",
                from: me.username,
                to,
                data: meta.data
            };

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
        console.log("Connection closed: " + socket_id);
        const user = users.get(socket_id);
        sessions.delete(socket_id);
        users.delete(socket_id);
        contacts.delete(socket_id);
        pendingVerifications.delete(socket_id);

        if (user?.username) {
            const lower = user.username.toLowerCase();
            // no borrar la entrada si ya la reemplazó un socket nuevo (reconexión)
            if (usernameIndex.get(lower)?.socketId === socket_id) {
                usernameIndex.delete(lower);
            }
        }
        for (const set of contacts.values()) set.delete(socket_id);
        sendOnlineUsers();
    });
});

io.on("error", (error) => {
    console.log("Server error:", error);
});