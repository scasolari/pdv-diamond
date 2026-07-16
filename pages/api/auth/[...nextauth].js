import NextAuth from "next-auth";
import FacebookProvider from "next-auth/providers/facebook";
import Github from "next-auth/providers/github";
import { PrismaAdapter } from "@next-auth/prisma-adapter";
import prisma from "@/lib/db";

const sessionMaxAge = 30 * 24 * 60 * 60;
const useSecureCookies = process.env.NEXTAUTH_URL?.startsWith("https://") ?? false;

export default NextAuth({
    adapter: PrismaAdapter(prisma),
    secret: process.env.NEXTAUTH_SECRET,
    pages: {
        signIn: "/",
        error: "/",
    },
    session: {
        strategy: "jwt",
        maxAge: sessionMaxAge,
        updateAge: 24 * 60 * 60,
    },
    cookies: {
        sessionToken: {
            name: useSecureCookies ? "__Secure-next-auth.session-token" : "next-auth.session-token",
            options: {
                httpOnly: true,
                sameSite: "lax",
                path: "/",
                secure: useSecureCookies,
                maxAge: sessionMaxAge,
            },
        },
    },
    providers: [
        Github({
            clientId: process.env.GITHUB_CLIENT_ID,
            clientSecret: process.env.GITHUB_CLIENT_SECRET,
            allowDangerousEmailAccountLinking: true,
        }),
        FacebookProvider({
            clientId: process.env.FACEBOOK_CLIENT_ID,
            clientSecret: process.env.FACEBOOK_CLIENT_SECRET,
            allowDangerousEmailAccountLinking: true,
        })
    ],
    callbacks: {
        session: async ({ session, token }) => {
            if(session?.user) {
                session.user.id = token.id
                session.user.role = token.role
                session.user.access_token = token.access_token
                session.user.provider = token.provider
                session.user.is2FAEnabled = token.is2FAEnabled
                session.user.is2FAActive = token.is2FAActive
            }
            return session;
        },
        jwt: async ({ user, token , account}) => {
            if(user) {
                token.id = user.id
                token.role = user.role
                token.access_token = account.access_token
                token.provider = account.provider
                token.is2FAEnabled = user.is2FAEnabled
                token.is2FAActive = user.is2FAActive
            }
            return token;
        },
    }
});
