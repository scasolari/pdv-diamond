import { authenticator } from '@otplib/preset-default';
import { getToken } from "next-auth/jwt";
import db from "@/lib/db";
const CryptoJS = require("crypto-js");

export default async function handler(req, res) {
    const session = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });

    if (session) {
        const { token } = req.body;

        const user = await db.user.findUnique({
            where: {
                email: session.email,
            },
        });

        if (!user) {
            return res.status(400).json({ verified: false, message: 'User not found' });
        }

        const secret = user.twoFASecret;

        const secretDeSigned  = CryptoJS.AES.decrypt(secret, process.env.NEXTAUTH_SECRET);
        const secretOriginal = secretDeSigned.toString(CryptoJS.enc.Utf8);

        if (!secretOriginal) {
            return res.status(400).json({ verified: false, message: '2FA secret not found' });
        }

        try {
            // Verifica il codice TOTP
            const isValid = authenticator.verify({ token, secret: secretOriginal });

            if (isValid) {
                res.setHeader('Set-Cookie', `2fa_session=${session.id}; Path=/; HttpOnly; SameSite=Strict`);
                res.status(200).json({ verified: true });
            } else {
                res.status(400).json({ verified: false, message: 'Codice TOTP non valido' });
            }
        } catch (error) {
            console.error('Error during decryption or verification:', error);
            res.status(500).json({ verified: false, message: 'Internal Server Error' });
        }
    } else {
        return res.status(400).json({ message: 'User not authorized.' });
    }
}
