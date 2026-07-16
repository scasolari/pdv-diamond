import db from "@/lib/db";

export default async function handler(req, res) {
    if (req.method === "GET") {
        const showArchived = req.query.archived === "true";
        const devices = await db.savedDevice.findMany({
            where: {
                archivedAt: showArchived ? { not: null } : null,
            },
            orderBy: {
                updatedAt: "desc",
            },
        });

        return res.status(200).json(devices);
    }

    if (req.method === "POST") {
        const payload = req.body || {};

        if (!payload.sourceKey || !payload.alias || !payload.name || !payload.transport) {
            return res.status(400).json({ message: "Missing device fields." });
        }

        const savedDevice = await db.savedDevice.upsert({
            where: {
                sourceKey: payload.sourceKey,
            },
            update: {
                alias: payload.alias,
                name: payload.name,
                baudRate: Number(payload.baudRate) || 115200,
                transport: payload.transport,
                type: payload.type,
                source: payload.source,
                path: payload.path ?? null,
                address: payload.address ?? null,
                port: payload.port ?? null,
                protocol: payload.protocol ?? null,
                manufacturer: payload.manufacturer ?? null,
                serialNumber: payload.serialNumber ?? null,
                vendorId: payload.vendorId ?? null,
                productId: payload.productId ?? null,
                pnpId: payload.pnpId ?? null,
                archivedAt: null,
            },
            create: {
                sourceKey: payload.sourceKey,
                alias: payload.alias,
                name: payload.name,
                baudRate: Number(payload.baudRate) || 115200,
                transport: payload.transport,
                type: payload.type,
                source: payload.source,
                path: payload.path ?? null,
                address: payload.address ?? null,
                port: payload.port ?? null,
                protocol: payload.protocol ?? null,
                manufacturer: payload.manufacturer ?? null,
                serialNumber: payload.serialNumber ?? null,
                vendorId: payload.vendorId ?? null,
                productId: payload.productId ?? null,
                pnpId: payload.pnpId ?? null,
                archivedAt: null,
            },
        });

        return res.status(200).json(savedDevice);
    }

    return res.status(405).json({ message: "Method not allowed." });
}
