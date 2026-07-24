import { requireAuthToken } from "@/lib/auth";
import { createTerminalToken } from "@/lib/terminalAuth";

export default async function handler(req, res) {
    if (req.method !== "GET") {
        return res.status(405).json({ error: "Method not allowed" });
    }

    const token = await requireAuthToken(req, res);

    if (!token) {
        return;
    }

    return res.status(200).json({
        token: createTerminalToken({
            userId: token.id,
            admin: Boolean(token.admin),
        }),
    });
}
