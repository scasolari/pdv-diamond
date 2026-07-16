import { Button } from "@/components/ui/button";
import { getCsrfToken, useSession } from "next-auth/react";
import { PiGithubLogoBold, PiMetaLogoBold } from "react-icons/pi";
import { useRouter } from "next/router";
import { useEffect } from "react";

export default function Home({ csrfToken }) {
    const router = useRouter();
    const { status } = useSession();
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

    if (status === "loading") {
        return null;
    }

    return <div className="flex flex-col gap-3 p-3">
        {authErrorMessage ? (
            <div className="w-fit rounded-lg bg-red-500 px-3 py-2 text-sm font-semibold text-white">
                {authErrorMessage}
            </div>
        ) : null}
        <form method="post" action="/api/auth/signin/facebook" className="w-fit">
            <input type="hidden" name="csrfToken" value={csrfToken || ""} />
            <input type="hidden" name="callbackUrl" value="/app/dashboard" />
            <Button type="submit" className="w-fit flex flex-row gap-2 bg-blue-600 shadow-none hover:bg-blue-700">
                <PiMetaLogoBold/>
                Login with Meta
            </Button>
        </form>
        <form method="post" action="/api/auth/signin/github" className="w-fit">
            <input type="hidden" name="csrfToken" value={csrfToken || ""} />
            <input type="hidden" name="callbackUrl" value="/app/dashboard" />
            <Button type="submit" className="w-fit flex flex-row gap-2 bg-neutral-800 shadow-none hover:bg-neutral-950">
                <PiGithubLogoBold/>
                Login with GitHub
            </Button>
        </form>
    </div>
}

export async function getServerSideProps(context) {
    const csrfToken = await getCsrfToken(context);

    return {
        props: {
            csrfToken: csrfToken || null,
        },
    };
}
