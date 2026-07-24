import { Button } from "@/components/ui/button";
import { useSession } from "next-auth/react";
import { PiGithubLogoBold, PiMetaLogoBold } from "react-icons/pi";
import { useRouter } from "next/router";
import { useEffect, useState } from "react";

export default function Home() {
    const router = useRouter();
    const { status } = useSession();
    const [csrfToken, setCsrfToken] = useState("");
    const [availableProviders, setAvailableProviders] = useState({});
    const authError = typeof router.query?.error === "string" ? router.query.error : null;

    const authErrorMessage = authError === "OAuthAccountNotLinked"
        ? "Esiste gia un account con questa email. Accedi con lo stesso provider usato la prima volta oppure collega gli account."
        : authError
            ? "Accesso non riuscito. Riprova."
            : null;

    useEffect(() => {
        if (status === "authenticated") {
            router.replace("/app/dashboard");
        }
    }, [router, status]);

    useEffect(() => {
        let cancelled = false;

        async function loadAuthConfig() {
            try {
                const [csrfResponse, providersResponse] = await Promise.all([
                    fetch("/api/auth/csrf"),
                    fetch("/api/auth/providers"),
                ]);
                const csrfPayload = await csrfResponse.json();
                const providersPayload = await providersResponse.json();

                if (!cancelled) {
                    setCsrfToken(csrfPayload?.csrfToken || "");
                    setAvailableProviders(providersPayload || {});
                }
            } catch (error) {
                if (!cancelled) {
                    setCsrfToken("");
                    setAvailableProviders({});
                }
            }
        }

        loadAuthConfig();

        return () => {
            cancelled = true;
        };
    }, []);

    if (status === "loading") {
        return null;
    }

    const hasFacebookProvider = Boolean(availableProviders?.facebook);
    const hasGithubProvider = Boolean(availableProviders?.github);

    return <div className="flex flex-col gap-3 p-3">
        {authErrorMessage ? (
            <div className="w-fit rounded-lg bg-red-500 px-3 py-2 text-sm font-semibold text-white">
                {authErrorMessage}
            </div>
        ) : null}
        {hasFacebookProvider ? (
            <form method="post" action="/api/auth/signin/facebook" className="w-fit">
                <input type="hidden" name="csrfToken" value={csrfToken || ""} />
                <input type="hidden" name="callbackUrl" value="/app/dashboard" />
                <Button type="submit" className="w-fit flex flex-row gap-2 bg-blue-600 shadow-none hover:bg-blue-700">
                    <PiMetaLogoBold/>
                    Login with Meta
                </Button>
            </form>
        ) : null}
        {hasGithubProvider ? (
            <form method="post" action="/api/auth/signin/github" className="w-fit">
                <input type="hidden" name="csrfToken" value={csrfToken || ""} />
                <input type="hidden" name="callbackUrl" value="/app/dashboard" />
                <Button type="submit" className="w-fit flex flex-row gap-2 bg-neutral-800 shadow-none hover:bg-neutral-950">
                    <PiGithubLogoBold/>
                    Login with GitHub
                </Button>
            </form>
        ) : null}
    </div>
}
