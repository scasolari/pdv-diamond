import { PrismaClient } from "@prisma/client";

const prismaLogLevels = process.env.NODE_ENV === "development" ? ["info"] : [];
function createPrismaClient() {
    return new PrismaClient({ log: prismaLogLevels });
}

function hasRequiredDelegates(client) {
    return Boolean(client?.appSetting && client?.savedDevice && client?.mission);
}

const prisma =
    hasRequiredDelegates(global.prisma)
        ? global.prisma
        : createPrismaClient();

if (process.env.NODE_ENV !== "production") {
    global.prisma = prisma;
}

export default prisma;
