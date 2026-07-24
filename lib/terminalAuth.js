import crypto from "crypto";

const TERMINAL_TOKEN_TTL_SECONDS = 60;

function base64UrlEncode(value) {
    return Buffer.from(value).toString("base64url");
}

function getSecret() {
    return process.env.NEXTAUTH_SECRET || "";
}

export function createTerminalToken({ userId, admin = false }) {
    const payload = {
        uid: userId,
        admin: Boolean(admin),
        exp: Date.now() + TERMINAL_TOKEN_TTL_SECONDS * 1000,
    };

    const payloadString = JSON.stringify(payload);
    const signature = crypto
        .createHmac("sha256", getSecret())
        .update(payloadString)
        .digest("base64url");

    return `${base64UrlEncode(payloadString)}.${signature}`;
}
