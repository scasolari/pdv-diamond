import db from "@/lib/db";
import { Prisma } from "@prisma/client";

export default async function handler(req, res) {
    const { id } = req.query;

    if (!id || typeof id !== "string") {
        return res.status(400).json({ message: "Invalid device id." });
    }

    if (req.method === "GET") {
        const device = await db.savedDevice.findUnique({
            where: {
                id,
            },
        });

        if (!device) {
            return res.status(404).json({ message: "Device not found." });
        }

        return res.status(200).json(device);
    }

    if (req.method === "PATCH") {
        const payload = req.body || {};
        const data = {};

        if (typeof payload.archived === "boolean") {
            data.archivedAt = payload.archived ? new Date() : null;
        }

        if (typeof payload.alias === "string") {
            const trimmedAlias = payload.alias.trim();

            if (!trimmedAlias) {
                return res.status(400).json({ message: "Alias is required." });
            }

            data.alias = trimmedAlias;
        }

        if (payload.baudRate !== undefined) {
            const nextBaudRate = Number(payload.baudRate);

            if (!Number.isInteger(nextBaudRate) || nextBaudRate <= 0) {
                return res.status(400).json({ message: "Invalid baud rate." });
            }

            data.baudRate = nextBaudRate;
        }

        try {
            const device = await db.savedDevice.update({
                where: {
                    id,
                },
                data,
            });

            return res.status(200).json(device);
        } catch (error) {
            if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
                return res.status(404).json({ message: "Device not found." });
            }

            throw error;
        }
    }

    if (req.method === "DELETE") {
        try {
            await db.savedDevice.delete({
                where: {
                    id,
                },
            });

            return res.status(200).json({ success: true });
        } catch (error) {
            if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
                return res.status(404).json({ message: "Device not found." });
            }

            throw error;
        }
    }

    return res.status(405).json({ message: "Method not allowed." });
}
