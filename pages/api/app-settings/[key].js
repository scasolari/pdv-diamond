import db from "@/lib/db";
import { getToken } from "next-auth/jwt";

const ALLOWED_SETTING_KEYS = new Set([
    "theme",
    "sidebarWidth",
    "deviceTerminalHeight",
    "deleteDeviceConfirmation",
    "archiveDeviceConfirmation",
]);

export default async function handler(req, res) {
    const session = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });

    if (!session) {
        return res.status(401).json({ message: "User not authenticated" });
    }

    const { key } = req.query;

    if (!key || typeof key !== "string") {
        return res.status(400).json({ message: "Invalid setting key." });
    }

    if (!ALLOWED_SETTING_KEYS.has(key)) {
        return res.status(403).json({ message: "Setting key is not allowed." });
    }

    if (req.method === "GET") {
        const setting = await db.appSetting.findUnique({
            where: { key },
        });

        return res.status(200).json({
            key,
            value: setting?.value ?? null,
        });
    }

    if (req.method === "PUT") {
        const { value } = req.body || {};

        if (value === undefined || value === null) {
            return res.status(400).json({ message: "Missing setting value." });
        }

        const setting = await db.appSetting.upsert({
            where: { key },
            update: { value: String(value) },
            create: {
                key,
                value: String(value),
            },
        });

        return res.status(200).json(setting);
    }

    return res.status(405).json({ message: "Method not allowed." });
}
