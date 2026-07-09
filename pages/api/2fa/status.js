import {getToken} from "next-auth/jwt";
import db from "@/lib/db";

export default async function handler(req, res) {
    const session = await getToken({req, secret: process.env.NEXTAUTH_SECRET});
    const { status } = req.body

    if(!session) {
        return res.status(401).send({message: "Not authenticated"})
    }

    await db.$connect()
    const fetchUser = await db.user.update({
        where: {
            id: session.id
        },
        data: {
            is2FAEnabled: status
        }
    })
    const stringifyResponse = JSON.stringify(fetchUser)
    await db.$disconnect()
    return res.status(201).json(JSON.parse(stringifyResponse))
}
