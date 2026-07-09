// pages/api/auth/custom-signout.js
export default async function handler(req, res) {
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
