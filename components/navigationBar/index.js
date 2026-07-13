import Link from "next/link";
import { useRouter } from "next/router";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useSession } from "next-auth/react";
import { setProfile } from "@/redux/actions/main";
import { connect } from "react-redux";
import { useEffect, useState } from "react";
import useLogout from "@/lib/logout";
import Avatar, { genConfig } from "react-nice-avatar";

function NavigationBar(props) {
    const { profile, setProfile } = props;
    const { data: session } = useSession();
    const router = useRouter();
    const logout = useLogout();
    const config = genConfig(profile?.user?.email);
    const [updateStatus, setUpdateStatus] = useState({
        state: "idle",
        label: "Check for updates",
    });

    const linkActive = (path) => {
        return router.pathname === path;
    };

    const shouldShowUpdateEntry = ["available", "downloading", "downloaded"].includes(updateStatus.state);

    async function handleUpdateEntryClick() {
        if (!window?.electron?.checkForUpdates) {
            return;
        }

        try {
            const result = await window.electron.checkForUpdates();

            if (result) {
                setUpdateStatus(result);
            }
        } catch (error) {
            return;
        }
    }

    useEffect(() => {
        setProfile(session);
    }, [session, setProfile]);

    useEffect(() => {
        let isMounted = true;
        let unsubscribe;

        async function loadUpdateStatus() {
            if (!window?.electron?.getAppInfo) {
                return;
            }

            try {
                const info = await window.electron.getAppInfo();

                if (isMounted && info?.updateStatus) {
                    setUpdateStatus(info.updateStatus);
                }
            } catch (error) {
                return;
            }
        }

        loadUpdateStatus();

        if (window?.electron?.onUpdateStatus) {
            unsubscribe = window.electron.onUpdateStatus((status) => {
                if (isMounted && status) {
                    setUpdateStatus(status);
                }
            });
        }

        return () => {
            isMounted = false;
            unsubscribe?.();
        };
    }, []);

    if(!session) return null;

    return (
        <div className="h-screen w-full dark:bg-neutral-800/20 bg-neutrel-50">
            <div
                className="pl-[90px] flex items-center h-11 px-6 w-full"
                style={{ WebkitAppRegion: "drag" }}
            >
                <Link href="/app/dashboard" className="absolute font-semibold text-sm w-fit z-50">
                    Placedv
                </Link>
            </div>
            {linkActive("/app/dashboard")
                ? <div className="flex flex-col gap-2 justify-between h-[calc(100vh-45px)]">
                    <ul className="p-3 grid gap-1">
                        <li>
                            <Link
                                href="/app/dashboard"
                                className={`font-semibold text-xs flex items-center gap-3 p-1.5 px-2 hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded-lg ${linkActive("/app/dashboard") ? `!bg-neutral-100 dark:!bg-neutral-800` : null}`}
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-gauge-icon lucide-gauge"><path d="m12 14 4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/></svg>
                                Dashboard
                            </Link>
                        </li>
                    </ul>
                    <ul className="p-3 grid gap-1">
                        {shouldShowUpdateEntry ? (
                            <li>
                                <button
                                    type="button"
                                    onClick={handleUpdateEntryClick}
                                    className="font-semibold text-xs flex items-center gap-3 p-1.5 px-2 text-blue-500 bg-blue-50 hover:bg-blue-100 dark:hover:bg-neutral-800 rounded-lg"
                                >
                                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-download-icon lucide-download"><path d="M12 15V3"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/></svg>
                                    {updateStatus.state === "downloaded" ? "Restart to update" : "New version available"}
                                </button>
                            </li>
                        ) : null}
                        <li>
                            <Link
                                href="/app/settings/general"
                                className={`font-semibold text-xs flex items-center gap-3 p-1.5 px-2 hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded-lg ${linkActive("/app/settings") ? `!bg-blue-100 dark:!bg-neutral-800` : null}`}
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-settings-icon lucide-settings"><path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915"/><circle cx="12" cy="12" r="3"/></svg>
                                Settings
                            </Link>
                        </li>
                    </ul>
                </div>
                : <div className="flex flex-col gap-2 justify-between h-[calc(100vh-45px)]">
                    <ul className="p-3 grid gap-1">
                        <li>
                            <Link
                                href="/app/settings/general"
                                className={`font-semibold text-xs flex items-center gap-3 p-1.5 px-2 text-neutral-400 hover:text-neutral-900 dark:text-neutral-600 hover:dark:text-white rounded-lg ${linkActive("/app/settings/general") ? `!text-neutral-900 dark:!text-white` : null}`}
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-settings2-icon lucide-settings-2"><path d="M14 17H5"/><path d="M19 7h-9"/><circle cx="17" cy="17" r="3"/><circle cx="7" cy="7" r="3"/></svg>
                                General
                            </Link>
                        </li>
                        <li>
                            <Link
                                href="/app/settings/archive"
                                className={`font-semibold text-xs flex items-center gap-3 p-1.5 px-2 text-neutral-400 hover:text-neutral-900 dark:text-neutral-600 hover:dark:text-white rounded-lg ${linkActive("/app/settings/archive") ? `!text-neutral-900 dark:!text-white` : null}`}
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-archive-icon lucide-archive"><rect width="20" height="5" x="2" y="3" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/><path d="M10 12h4"/></svg>
                                Archive
                            </Link>
                        </li>
                    </ul>
                    <ul className="p-3 grid gap-1">
                        <li onClick={logout}>
                            <p
                                className={`cursor-pointer font-semibold text-xs flex items-center gap-3 p-1.5 px-2 hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded-lg ${linkActive("/app/dashboard") ? `!bg-blue-100 dark:!bg-neutral-800` : null}`}
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-log-out-icon lucide-log-out"><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/></svg>
                                Sign out from Placedv AI
                            </p>
                        </li>
                        <li>
                            <Link
                                href="/app/dashboard"
                                className={`font-semibold text-xs flex items-center gap-3 p-1.5 px-2 hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded-lg ${linkActive("/app/dashboard") ? `!bg-blue-100 dark:!bg-neutral-800` : null}`}
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-arrow-left-icon lucide-arrow-left"><path d="m12 19-7-7 7-7"/><path d="M19 12H5"/></svg>
                                Back
                            </Link>
                        </li>
                    </ul>
                </div>
            }

        </div>
    );
}

const mapStateToProps = (state) => {
    return {
        profile: state.profile,
    };
};

const mapDispatchToProps = {
    setProfile,
};

export default connect(mapStateToProps, mapDispatchToProps)(NavigationBar);
