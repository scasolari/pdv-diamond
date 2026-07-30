import { PrismaClient } from "@prisma/client";

const prismaLogLevels = process.env.NODE_ENV === "development" ? ["info"] : [];
const prisma = global.prisma || new PrismaClient({ log: prismaLogLevels });
if (process.env.NODE_ENV !== "production") global.prisma = prisma;

export default prisma;
