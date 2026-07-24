// pages/api/auth/custom-signout.js
import { getToken } from "next-auth/jwt";

export default async function handler(req, res) {
    const session = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });

    if (!session) {
        return res.status(401).json({ message: "User not authenticated" });
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ message: 'Method not allowed' });
    }

    // Elimina il cookie 2FA server-side
    res.setHeader('Set-Cookie', [
        '2fa_session=; Path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly',
        '2fa_session=; Path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT'
    ]);

    res.status(200).json({ success: true });
}
