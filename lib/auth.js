import { getToken } from "next-auth/jwt";

export async function getAuthToken(req) {
    return getToken({ req, secret: process.env.NEXTAUTH_SECRET });
}

export async function requireAuthToken(req, res) {
    const token = await getAuthToken(req);

    if (!token) {
        if (res) {
            res.status(401).json({ error: "User not authenticated" });
        }

        return null;
    }

    return token;
}
