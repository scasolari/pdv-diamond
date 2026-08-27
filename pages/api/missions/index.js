import { randomUUID } from "node:crypto";
import db from "@/lib/db";
import { requireAuthToken } from "@/lib/auth";

function parseFilesJson(value) {
    try {
        const parsed = JSON.parse(value || "[]");
        return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
        return [];
    }
}

async function findMissions() {
    if (db?.mission?.findMany) {
        const missions = await db.mission.findMany({
            orderBy: {
                updatedAt: "desc",
            },
            include: {
                device: true,
            },
        });

        return missions.map((mission) => ({
            ...mission,
            files: parseFilesJson(mission.filesJson),
        }));
    }

    const missions = await db.$queryRawUnsafe(`
        SELECT
            m.id,
            m.name,
            m.deviceId,
            m.remotePath,
            m.entrypoint,
            m.notes,
            m.filesJson,
            m.status,
            m.createdAt,
            m.updatedAt,
            d.id AS device_id,
            d.sourceKey AS device_sourceKey,
            d.alias AS device_alias,
            d.name AS device_name,
            d.baudRate AS device_baudRate,
            d.transport AS device_transport,
            d.type AS device_type,
            d.source AS device_source,
            d.path AS device_path,
            d.address AS device_address,
            d.port AS device_port,
            d.protocol AS device_protocol,
            d.manufacturer AS device_manufacturer,
            d.serialNumber AS device_serialNumber,
            d.vendorId AS device_vendorId,
            d.productId AS device_productId,
            d.pnpId AS device_pnpId,
            d.mac AS device_mac,
            d.interface AS device_interface,
            d.archivedAt AS device_archivedAt,
            d.createdAt AS device_createdAt,
            d.updatedAt AS device_updatedAt
        FROM Mission m
        INNER JOIN SavedDevice d ON d.id = m.deviceId
        ORDER BY m.updatedAt DESC
    `);

    return missions.map((mission) => ({
        id: mission.id,
        name: mission.name,
        deviceId: mission.deviceId,
        remotePath: mission.remotePath,
        entrypoint: mission.entrypoint,
        notes: mission.notes,
        filesJson: mission.filesJson,
        files: parseFilesJson(mission.filesJson),
        status: mission.status,
        createdAt: mission.createdAt,
        updatedAt: mission.updatedAt,
        device: {
            id: mission.device_id,
            sourceKey: mission.device_sourceKey,
            alias: mission.device_alias,
            name: mission.device_name,
            baudRate: mission.device_baudRate,
            transport: mission.device_transport,
            type: mission.device_type,
            source: mission.device_source,
            path: mission.device_path,
            address: mission.device_address,
            port: mission.device_port,
            protocol: mission.device_protocol,
            manufacturer: mission.device_manufacturer,
            serialNumber: mission.device_serialNumber,
            vendorId: mission.device_vendorId,
            productId: mission.device_productId,
            pnpId: mission.device_pnpId,
            mac: mission.device_mac,
            interface: mission.device_interface,
            archivedAt: mission.device_archivedAt,
            createdAt: mission.device_createdAt,
            updatedAt: mission.device_updatedAt,
        },
    }));
}

async function createMissionRecord({ name, deviceId, remotePath, entrypoint, notes, files }) {
    if (db?.mission?.create) {
        const mission = await db.mission.create({
            data: {
                name,
                deviceId,
                remotePath,
                entrypoint,
                notes: notes || null,
                filesJson: JSON.stringify(files),
            },
            include: {
                device: true,
            },
        });

        return {
            ...mission,
            files,
        };
    }

    const id = randomUUID();
    const timestamp = new Date().toISOString();

    await db.$executeRawUnsafe(
        `
            INSERT INTO Mission (
                id,
                name,
                deviceId,
                remotePath,
                entrypoint,
                notes,
                filesJson,
                status,
                createdAt,
                updatedAt
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        id,
        name,
        deviceId,
        remotePath,
        entrypoint,
        notes || null,
        JSON.stringify(files),
        "draft",
        timestamp,
        timestamp
    );

    const device = await db.savedDevice.findUnique({
        where: {
            id: deviceId,
        },
    });

    return {
        id,
        name,
        deviceId,
        remotePath,
        entrypoint,
        notes: notes || null,
        filesJson: JSON.stringify(files),
        files,
        status: "draft",
        createdAt: timestamp,
        updatedAt: timestamp,
        device,
    };
}

export default async function handler(req, res) {
    const session = await requireAuthToken(req, res);

    if (!session) {
        return;
    }

    if (req.method === "GET") {
        const missions = await findMissions();
        return res.status(200).json(missions);
    }

    if (req.method === "POST") {
        const payload = req.body || {};
        const name = String(payload.name || "").trim();
        const deviceId = String(payload.deviceId || "").trim();
        const remotePath = String(payload.remotePath || "").trim();
        const entrypoint = String(payload.entrypoint || "").trim();
        const notes = typeof payload.notes === "string" ? payload.notes.trim() : "";
        const files = Array.isArray(payload.files)
            ? payload.files
                .map((file) => ({
                    name: String(file?.name || "").trim(),
                    size: Number(file?.size) || 0,
                }))
                .filter((file) => file.name)
            : [];

        if (!name || !deviceId || !remotePath || !entrypoint) {
            return res.status(400).json({ message: "Missing required mission fields." });
        }

        const device = await db.savedDevice.findUnique({
            where: {
                id: deviceId,
            },
        });

        if (!device) {
            return res.status(404).json({ message: "Selected device not found." });
        }

        const mission = await createMissionRecord({
            name,
            deviceId,
            remotePath,
            entrypoint,
            notes,
            files,
        });

        return res.status(200).json(mission);
    }

    return res.status(405).json({ message: "Method not allowed." });
}
