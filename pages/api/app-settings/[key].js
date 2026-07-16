import db from "@/lib/db";

export default async function handler(req, res) {
    const { key } = req.query;

    if (!key || typeof key !== "string") {
        return res.status(400).json({ message: "Invalid setting key." });
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
