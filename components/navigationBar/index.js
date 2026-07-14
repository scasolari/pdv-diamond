import Link from "next/link";
import { useRouter } from "next/router";
import { Badge } from "@/components/ui/badge"
import { useSession } from "next-auth/react";
import { setProfile } from "@/redux/actions/main";
import { connect } from "react-redux";
import { useEffect, useState } from "react";
import useLogout from "@/lib/logout";
import Avatar, { genConfig } from "react-nice-avatar";
import {
    Command,
    CommandDialog,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
    CommandSeparator,
    CommandShortcut,
} from "@/components/ui/command"

function NavigationBar(props) {
    const { profile, setProfile } = props;
    const [open, setOpen] = useState(false)
    const { data: session } = useSession();
    const router = useRouter();
    const logout = useLogout();
    const config = genConfig(profile?.user?.email);
    const [updateStatus, setUpdateStatus] = useState({
        state: "idle",
        label: "Check for updates",
        progress: null,
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
                        <CommandDialog open={open} onOpenChange={setOpen}>
                            <Command className="dark:bg-neutral-900 bg-neutral-100">
                                <CommandInput className="!font-semibold !text-xs !h-10 p-0 flex items-center" placeholder="Type a command or search..." />
                                <CommandList className="pb-1 border-t border-b dark:border-neutral-800 rounded-t-xl dark:bg-neutral-950/40 bg-white">
                                    <CommandEmpty className="!font-semibold !text-xs p-3">No results found.</CommandEmpty>
                                    <CommandGroup heading="Action">
                                        <CommandItem className="!font-semibold !text-xs h-7 rounded-lg flex flex-row gap-2">
                                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" class="!h-[14px] lucide lucide-layers-plus-icon lucide-layers-plus"><path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 .83.18 2 2 0 0 0 .83-.18l8.58-3.9a1 1 0 0 0 0-1.831z"/><path d="M16 17h6"/><path d="M19 14v6"/><path d="M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 .825.178"/><path d="M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l2.116-.962"/></svg>
                                            New sanity-check
                                        </CommandItem>
                                        <CommandItem className="h-7 rounded-lg flex flex-row gap-2">
                                            <Link href="/app/settings/general" className="items-center w-full !font-semibold !text-xs h-7 rounded-lg flex flex-row gap-2">
                                                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" class="!h-[14px] lucide lucide-settings-icon lucide-settings"><path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915"/><circle cx="12" cy="12" r="3"/></svg>
                                                Open settings
                                            </Link>
                                        </CommandItem>
                                    </CommandGroup>
                                    <CommandGroup heading="Recent sanity">
                                        <CommandItem className="!font-semibold !text-xs h-7 rounded-lg flex flex-row gap-2">
                                            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="!h-[14px] lucide lucide-file-icon lucide-file"><path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"/><path d="M14 2v5a1 1 0 0 0 1 1h5"/></svg>
                                            Mediolanum sanity
                                        </CommandItem>
                                    </CommandGroup>
                                </CommandList>
                                <div className="p-3">
                                    <div className="text-xs font-semibold flex flex-row items-center gap-1">
                                        <div className="flex flex-row items-center gap-1">
                                            <div className="flex items-center bg-neutral-200 dark:bg-neutral-800 p-0.5 rounded-md">
                                                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="!h-[14px] !w-[14px] lucide lucide-arrow-up-icon lucide-arrow-up"><path d="m5 12 7-7 7 7"/><path d="M12 19V5"/></svg>
                                            </div>
                                            <div className="flex items-center bg-neutral-200 dark:bg-neutral-800 p-0.5 rounded-md">
                                                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="!h-[14px] !w-[14px] lucide lucide-arrow-down-icon lucide-arrow-down"><path d="M12 5v14"/><path d="m19 12-7 7-7-7"/></svg>
                                            </div>
                                        </div>
                                        Navigate
                                        <div className="flex flex-row items-center gap-1">
                                            <div className="flex items-center bg-neutral-200 dark:bg-neutral-800 p-0.5 px-1 rounded-md">
                                                Enter
                                            </div>
                                        </div>
                                        Select
                                        <div className="flex flex-row items-center gap-1">
                                            <div className="flex items-center bg-neutral-200 dark:bg-neutral-800 p-0.5 px-1 rounded-md">
                                                Esc
                                            </div>
                                        </div>
                                        Close
                                    </div>
                                </div>
                            </Command>
                        </CommandDialog>
                        <li>
                            <Link
                                href="#"
                                onClick={() => setOpen(!open)}
                                className={`font-semibold text-xs flex justify-between items-center gap-3 p-1.5 px-2 hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded-lg`}
                            >
                                <div className="flex flex-row items-center gap-3">
                                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-search-icon lucide-search"><path d="m21 21-4.34-4.34"/><circle cx="11" cy="11" r="8"/></svg>
                                    Search
                                </div>
                                <Badge variant="secondary" className="p-0 px-1.5 text-[10px] h-fit font-semibold dark:bg-neutral-700/50 bg-neutral-200/50">
                                    ⌘K
                                </Badge>
                            </Link>
                        </li>
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
                                    className="w-full font-semibold text-xs flex items-center gap-3 p-1.5 px-2 text-blue-500 bg-blue-50 hover:bg-blue-100 dark:hover:bg-blue-950/70 rounded-lg dark:bg-blue-950"
                                >
                                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-download-icon lucide-download"><path d="M12 15V3"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/></svg>
                                    {updateStatus.state === "downloaded"
                                        ? "Restart to update"
                                        : updateStatus.state === "downloading"
                                            ? updateStatus.label
                                            : "New version available"}
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
