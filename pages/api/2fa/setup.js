import { authenticator } from '@otplib/preset-default';
import QRCode from 'qrcode';
import {getToken} from "next-auth/jwt";

const CryptoJS = require("crypto-js");

export default async function handler(req, res) {
    const session = await getToken({req, secret: process.env.NEXTAUTH_SECRET});

    if(!session) {
        return res.status(401).send({message: 'Authentication failed'});
    }

    // Genera una chiave segreta per l'utente
    const secret = authenticator.generateSecret();
    const email = session.email; // Assicurati di sostituirlo con l'email dell'utente

    // Genera un URL per il QR code
    const otpauth = authenticator.keyuri(email, 'PDV Query', secret);

    // Genera il QR code
    try {
        const qrCodeImage = await QRCode.toDataURL(otpauth);
        res.status(200).json({ secret, qrCodeImage });
    } catch (error) {
        res.status(500).json({ message: 'Errore nella generazione del QR code' });
    }
}
