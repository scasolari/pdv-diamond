// Next.js API route support: https://nextjs.org/docs/api-routes/introduction

import {getToken} from "next-auth/jwt";
import {authenticator} from "@otplib/preset-default";
import db from "@/lib/db";
const CryptoJS = require("crypto-js");

export default async function handler(req, res) {

    const {token, secret} = req.body

    const session = await getToken({req, secret: process.env.NEXTAUTH_SECRET});

    if(!session) {
        return res.status(401).send({message: 'User not logged in.'});
    }

    const isValid = authenticator.verify({ token, secret });

    if (!isValid) {
        return res.status(401).send({message: 'Invalid token.'});
    }

    const secretSigned = CryptoJS.AES.encrypt(secret, process.env.NEXTAUTH_SECRET).toString();

    await db.$connect()
    await db.user.update({
        where: {
            id: session.id
        },
        data: {
            twoFASecret: secretSigned,
            is2FAEnabled: true,
            is2FAActive: true
        }
    })
    await db.$disconnect()
    res.setHeader('Set-Cookie', `2fa_session=${session.id}; Path=/`);
    res.status(200).json({ verified: true });


    res.status(200).json({ name: "John Doe" });
}
