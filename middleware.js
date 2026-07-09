import { NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";

export { default } from "next-auth/middleware";

export const config = {
    matcher: ["/app/:path*"]
};

export async function middleware(req) {
    const session = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
    const is2FAVerified = req.cookies.get('2fa_session');
    const is2FAEnabled = session?.is2FAEnabled;
    const userId = session?.id;

    // In Electron/proxy locali il cookie puo cambiare nome in base a https/non-https.
    const sessionCookie =
        req.cookies.get("next-auth.session-token") ||
        req.cookies.get("__Secure-next-auth.session-token");

    // Verifica se l'utente è autenticato
    if (!sessionCookie) {
        return redirectTo(req, '/');
    }

    // Se 2FA non è abilitato, procedi
    if (!is2FAEnabled) {
        return NextResponse.next();
    }

    // Se 2FA è abilitato ma non verificato, reindirizza alla pagina di verifica
    if (!is2FAVerified) {
        return redirectTo(req, '/check/2fa');
    }

    return NextResponse.next();
}

// Funzione helper per semplificare i redirect
function redirectTo(req, pathname) {
    const url = req.nextUrl.clone();
    url.pathname = pathname;
    return NextResponse.redirect(url);
}
