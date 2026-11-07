"use strict";
const path = require("node:path");
const sqlite = require("sqlite3");
const zlib = require("node:zlib");

const db_path = process.env.SQLITE_PATH || path.join(__dirname, "data");

const db = new sqlite.Database(db_path, sqlite.OPEN_READWRITE | sqlite.OPEN_CREATE, (err) => {
    if (err) {
        console.error("Error opening database:", err.message);
    } else {
        console.log("Connected to the SQLite database.");
    }
});
const uuidSyntax = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;
/**
 * Convierte un UUID en un búfer binario de 16 bytes para almacenarlo en SQLite.
 * @param {string} uuid UUID con o sin guiones.
 * @returns {Buffer} Representación binaria del UUID.
 * @throws {TypeError} Si el valor no tiene un formato UUID válido.
 * @example const id = uuidToBinary("123e4567-e89b-12d3-a456-426614174000");
 */
function uuidToBinary(uuid) {
    if (typeof uuid !== "string" || !uuidSyntax.test(uuid)) {
        throw new TypeError("A valid UUID is required.");
    }
    const hex = uuid.replace(/-/g, "");
    const bytes = Buffer.alloc(16);
    for (let i = 0; i < 16; i++) {
        bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
    }
    return bytes;
}
/**
 * Convierte un valor binario de 16 bytes al formato UUID con guiones.
 * @param {Buffer|Uint8Array} binary UUID almacenado en formato binario.
 * @returns {string} UUID en formato estándar.
 * @throws {TypeError} Si el valor no contiene exactamente 16 bytes.
 * @example const id = binaryToUuid(uuidToBinary("123e4567-e89b-12d3-a456-426614174000"));
 */
function binaryToUuid(binary) {
    const hex = Buffer.from(binary).toString("hex");
    if (hex.length !== 32) {
        throw new TypeError("A 16-byte UUID value is required.");
    }
    return [
        hex.substring(0, 8),
        hex.substring(8, 12),
        hex.substring(12, 16),
        hex.substring(16, 20),
        hex.substring(20, 32)
    ].join('-');
}

// crear una tabla para almacenar las colas de mensajes de los usuarios. (SenderId?:compressed_Id<binary>, ReceipentId?:compressed_Id<binary>, date?:compressed_date, message?:string, delivered?:bool);
async function intializeDatabase() {
    return new Promise((resolve, reject) => {
        const query = `CREATE TABLE IF NOT EXISTS quedques (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        senderId BLOB NOT NULL,
        receipentId BLOB NOT NULL,
        date INTEGER NOT NULL,
        message TEXT,
        delivered INTEGER NOT NULL DEFAULT 0,
        compressed INTEGER NOT NULL DEFAULT 0
        )`;
        db.run(query, (err) => {
            if (err) {
                reject(err);
            } else {
                db.all("PRAGMA table_info(quedques)", (infoErr, columns) => {
                    if (infoErr) {
                        reject(infoErr);
                    } else if (columns.some(column => column.name === "compressed")) {
                        resolve();
                    } else {
                        db.run("ALTER TABLE quedques ADD COLUMN compressed INTEGER NOT NULL DEFAULT 0", (alterErr) => {
                            if (alterErr && !alterErr.message.includes("duplicate column name")) {
                                reject(alterErr);
                            } else {
                                resolve();
                            }
                        });
                    }
                });
            }
        });
    });
}
/**
 * Inserta un mensaje en la cola de mensajes.
 * @param {string} senderId UUID del remitente.
 * @param {string} receipentId UUID del destinatario.
 * @param {Date|number|string} date Fecha del mensaje; por defecto, la fecha actual.
 * @param {string} message Contenido del mensaje.
 * @param {boolean} delivered Indica si el mensaje ya fue entregado.
 * @param {boolean} compressed Guarda el mensaje comprimido para ahorrar espacio.
 * @returns {Promise<number>} ID de la fila insertada.
 * @example await addQuedque(senderUuid, recipientUuid, new Date(), "Hola");
 */
async function addQuedque(senderId = "", receipentId = "", date = new Date(), message = "", delivered = false, compressed = false) {
    await intializeDatabase();
    if (typeof message !== "string") {
        throw new TypeError("A string message is required.");
    }
    if (typeof compressed !== "boolean") {
        throw new TypeError("compressed must be a boolean.");
    }
    const timestamp = date instanceof Date ? date.getTime() : new Date(date).getTime();
    if (!Number.isFinite(timestamp)) {
        throw new TypeError("A valid message date is required.");
    }
    return new Promise((resolve, reject) => {
        const query = `INSERT INTO quedques (senderId, receipentId, date, message, delivered, compressed) VALUES (?, ?, ?, ?, ?, ?)`;
        const params = [
            uuidToBinary(senderId),
            uuidToBinary(receipentId),
            timestamp,
            compressed ? zlib.deflateSync(Buffer.from(message, "utf8")) : message,
            delivered ? 1 : 0,
            compressed ? 1 : 0
        ];
        db.run(query, params, function (err) {
            if (err) {
                reject(err);
            } else {
                resolve(this.lastID);
            }
        });
    });
};

// hay mensages pendientes para un usuario en particular (receipentId)?
/**
 * Comprueba si un destinatario tiene mensajes sin entregar.
 * @param {string} receipentId UUID del destinatario.
 * @returns {Promise<boolean>} `true` si hay mensajes pendientes.
 * @example const pending = await hasPendingMessages(recipientUuid);
 */
async function hasPendingMessages(receipentId = "") {
    await intializeDatabase();
    const uuidBinary = uuidToBinary(receipentId);
    return new Promise((resolve, reject) => {
        const query = `SELECT COUNT(*) AS count FROM quedques WHERE receipentId = ? AND delivered = 0`;
        db.get(query, [uuidBinary], (err, row) => {
            if (err) {
                reject(err);
            } else {
                resolve(row.count > 0);
            }
        });
    });
};

// obtener los mensajes pendientes para un usuario en particular (receipentId)
/**
 * Obtiene los mensajes sin entregar de un destinatario.
 * @param {string} receipentId UUID del destinatario.
 * @returns {Promise<Array<{senderId: string, receipentId: string, date: Date, message: string, delivered: boolean}>>} Mensajes pendientes.
 * @example const messages = await getPendingMessages(recipientUuid);
 */
async function getPendingMessages(receipentId = "") {
    await intializeDatabase();
    const uuidBinary = uuidToBinary(receipentId);
    return new Promise((resolve, reject) => {
        const query = `SELECT * FROM quedques WHERE receipentId = ? AND delivered = 0`;
        db.all(query, [uuidBinary], (err, rows) => {
            if (err) {
                reject(err);
            } else {
                const messages = rows.map(row => ({
                    senderId: binaryToUuid(row.senderId),
                    receipentId: binaryToUuid(row.receipentId),
                    date: new Date(row.date),
                    message: row.message == null ? row.message : (row.compressed
                        ? zlib.inflateSync(Buffer.from(row.message)).toString("utf8")
                        : row.message.toString()),
                    delivered: !!row.delivered,
                    compressed: !!row.compressed
                }));
                resolve(messages);
            }
        });
    });
};
// marcar los mensajes como entregados para un usuario en particular (receipentId)
/**
 * Marca como entregados los mensajes del destinatario cuyas fechas coincidan.
 * @param {string} [receipentId=""] - El ID del usuario que recibirá los mensajes.
 * @param {Array<Date|number|string>} [messageDates=[]] Fechas o marcas de tiempo de los mensajes.
 * @returns {Promise<number>} Número de filas actualizadas.
 * @example const updated = await markMessagesAsDelivered(recipientUuid, [messageDate]);
 */
async function markMessagesAsDelivered(receipentId = "", messageDates = []) {
    await intializeDatabase();
    if (!Array.isArray(messageDates)) {
        throw new TypeError("messageDates must be an array.");
    }
    if (messageDates.length === 0) {
        return 0;
    }
    const uuidBinary = uuidToBinary(receipentId);
    const timestamps = messageDates.map(date => date instanceof Date ? date.getTime() : Number(date));
    if (timestamps.some(date => !Number.isFinite(date))) {
        throw new TypeError("All message dates must be valid dates or timestamps.");
    }
    return new Promise((resolve, reject) => {
        const query = `UPDATE quedques SET delivered = 1, message = NULL WHERE receipentId = ? AND date IN (${timestamps.map(() => '?').join(',')})`;
        const params = [uuidBinary, ...timestamps];
        db.run(query, params, function (err) {
            if (err) {
                reject(err);
            } else {
                resolve(this.changes);
            }
        });
    });
};

module.exports = {
    db,
    uuidToBinary,
    binaryToUuid,
    intializeDatabase,
    addQuedque,
    hasPendingMessages,
    getPendingMessages,
    markMessagesAsDelivered
};