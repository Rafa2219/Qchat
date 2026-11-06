/* No usar esta madre esta desactualizado (se borra a la siguiente) 11/06/2026 12:22 PM */

const WebSocket = require("ws");
const crypto = require("node:crypto");
// const MSG_PORT = process.env.MSG_PORT || 3736;
const io = new WebSocket("https://message.antakim.uk");
const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: {
        type: "spki",
        format: "pem"
    },
    privateKeyEncoding: {
        type: "pkcs8",
        format: "pem"
    }
});
class cryptMessage {
    constructor() { };
    decode(privateKey, encodedText) {
        const raw = Buffer.from(encodedText, "base64");
        const encrypedAesKeyLength = 256;
        const encriptedAesKey = raw.subarray(0, encrypedAesKeyLength);
        const iv = raw.subarray(encrypedAesKeyLength, encrypedAesKeyLength + 12);
        const authTag = raw.subarray(encrypedAesKeyLength + 12, encrypedAesKeyLength + 28);
        const ciphertext = raw.subarray(encrypedAesKeyLength + 28);

        const aesKey = crypto.privateDecrypt({
            key: privateKey,
            padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
            oaepHash: "sha256"
        }, encriptedAesKey);

        const decipher = crypto.createDecipheriv("aes-256-gcm", aesKey, iv);

        decipher.setAuthTag(authTag);
        const decrypted = Buffer.concat([
            decipher.update(ciphertext),
            decipher.final()
        ]);
        const result = JSON.parse(decrypted.toString("utf-8"));
        return result;
    }
}


io.on("open", () => {
    console.log("conectado");

    io.send(JSON.stringify({
        type: "register.presence",
        username: "Rafi",
        publicKey: publicKey
    }))
});

io.on("message", (data) => {
    const received = JSON.parse(data.toString("utf-8"));
    if (received.type === "confirm") {
        const decript = new cryptMessage();
        const decriptedData = decript.decode(privateKey, received.data);
        console.log(decriptedData);
    } else if (["online.users", "presence.list"].includes(received.type)) {
        console.log("Online users:", received.users ?? received.data ?? []);
    } else {
        console.log(received);
    }
});

io.on("close", () => {
    console.log("Conexion finalizada por el servidor.")
})