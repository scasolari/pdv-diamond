import Link from "next/link";
import { useRouter } from "next/router";
import { Badge } from "@/components/ui/badge"
import { useSession } from "next-auth/react";
import { addSavedDevice, setProfile, setSavedDevices } from "@/redux/actions/main";
import { connect } from "react-redux";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useLogout from "@/lib/logout";
import { genConfig } from "react-nice-avatar";
import {
    Command,
    CommandDialog,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
} from "@/components/ui/command"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";

const DEVICE_STATUS_REFRESH_INTERVAL_MS = 30000;
let savedDeviceStatusCache = {};
let savedDeviceStatusLastCheckedAt = 0;
let savedDeviceStatusInFlightPromise = null;

function buildSavedDeviceSourceKey(device) {
    if (!device) {
        return "";
    }

    return [
        device.sourceKey,
        device.path,
        device.address,
        device.serialNumber,
        device.vendorId && device.productId ? `${device.vendorId}:${device.productId}` : "",
    ]
        .filter(Boolean)
        .join("|");
}

function createSavedDeviceStatusMap(savedDevices, detectedDevices) {
    const detectedKeys = new Set();

    detectedDevices.forEach((device) => {
        const directKeys = [
            device.id,
            device.path,
            device.address,
            device.serialNumber,
            device.vendorId && device.productId ? `${device.vendorId}:${device.productId}` : "",
        ].filter(Boolean);

        directKeys.forEach((key) => detectedKeys.add(key));
        detectedKeys.add(buildSavedDeviceSourceKey(device));
    });

    return Object.fromEntries(
        (savedDevices || []).map((device) => {
            const statusKey = buildSavedDeviceSourceKey(device);
            const isOnline =
                detectedKeys.has(device.sourceKey) ||
                detectedKeys.has(device.path) ||
                detectedKeys.has(device.address) ||
                detectedKeys.has(device.serialNumber) ||
                detectedKeys.has(device.vendorId && device.productId ? `${device.vendorId}:${device.productId}` : "") ||
                detectedKeys.has(statusKey);

            return [device.id, isOnline ? "online" : "offline"];
        })
    );
}

function buildSavedDevicesStatusSignature(savedDevices) {
    return (savedDevices || [])
        .map((device) => [
            device.id,
            device.sourceKey,
            device.path,
            device.address,
            device.serialNumber,
            device.vendorId,
            device.productId,
        ].join("|"))
        .sort()
        .join("::");
}

function NavigationBar(props) {
    const { profile, setProfile, ui, addSavedDevice, setSavedDevices } = props;
    const [open, setOpen] = useState(false)
    const [paletteMode, setPaletteMode] = useState("search")
    const [selectedDevice, setSelectedDevice] = useState(null)
    const [isDeviceDetailsOpen, setIsDeviceDetailsOpen] = useState(false)
    const [deviceAlias, setDeviceAlias] = useState("")
    const [deviceToRename, setDeviceToRename] = useState(null)
    const [renameDeviceValue, setRenameDeviceValue] = useState("")
    const [deviceToArchive, setDeviceToArchive] = useState(null)
    const [deviceToDelete, setDeviceToDelete] = useState(null)
    const [deleteConfirmationValue, setDeleteConfirmationValue] = useState("")
    const [deleteConfirmationEnabled, setDeleteConfirmationEnabled] = useState(true)
    const [archiveConfirmationEnabled, setArchiveConfirmationEnabled] = useState(true)
    const [unavailableDevice, setUnavailableDevice] = useState(null)
    const [openDeviceMenuId, setOpenDeviceMenuId] = useState(null)
    const [savedDeviceStatuses, setSavedDeviceStatuses] = useState({})
    const [savedDevicesStatusLoading, setSavedDevicesStatusLoading] = useState(false)
    const [devicesState, setDevicesState] = useState({
        loading: false,
        error: null,
        connected: [],
        groups: {
            usb: [],
            bluetooth: [],
            network: [],
        },
        network: {
            neighbors: [],
        },
    });
    const { data: session } = useSession();
    const router = useRouter();
    const logout = useLogout();
    const statusTrackedSavedDevicesRef = useRef([]);
    const config = genConfig(profile?.user?.email);
    const [updateStatus, setUpdateStatus] = useState({
        state: "idle",
        label: "Check for updates",
        progress: null,
    });

    const linkActive = (path) => {
        if (!path) {
            return false;
        }

        const normalizedPath = path.endsWith("/") && path !== "/" ? path.slice(0, -1) : path;
        const pathname = router.pathname.endsWith("/") && router.pathname !== "/" ? router.pathname.slice(0, -1) : router.pathname;
        const asPath = (router.asPath || "").split("?")[0].endsWith("/") && router.asPath !== "/"
            ? (router.asPath || "").split("?")[0].slice(0, -1)
            : (router.asPath || "").split("?")[0];

        return (
            pathname === normalizedPath ||
            asPath === normalizedPath ||
            pathname.startsWith(`${normalizedPath}/`) ||
            asPath.startsWith(`${normalizedPath}/`) ||
            pathname.startsWith(`${normalizedPath}/[`)
        );
    };

    const shouldShowUpdateEntry = ["available", "downloading", "downloaded"].includes(updateStatus.state);
    const isDevicePalette = paletteMode === "devices";
    const savedDevicesStatusSignature = useMemo(
        () => buildSavedDevicesStatusSignature(ui?.savedDevices || []),
        [ui?.savedDevices]
    );
    const statusTrackedSavedDevices = useMemo(
        () => (ui?.savedDevices || []).map((device) => ({
            id: device.id,
            sourceKey: device.sourceKey,
            path: device.path,
            address: device.address,
            serialNumber: device.serialNumber,
            vendorId: device.vendorId,
            productId: device.productId,
        })),
        [ui?.savedDevices]
    );

    useEffect(() => {
        statusTrackedSavedDevicesRef.current = statusTrackedSavedDevices;
    }, [statusTrackedSavedDevices]);
    function openSearchPalette() {
        setPaletteMode("search");
        setOpen(true);
    }

    function openDevicesPalette() {
        setPaletteMode("devices");
        setOpen(true);
    }

    function handleDetectedDeviceSelect(device) {
        setSelectedDevice(device);
        setDeviceAlias(device?.name || "");
        setOpen(false);
        setIsDeviceDetailsOpen(true);
    }

    function getSavedDeviceStatus(deviceId) {
        if (savedDevicesStatusLoading && !savedDeviceStatuses[deviceId]) {
            return "loading";
        }

        return savedDeviceStatuses[deviceId] || "offline";
    }

    function getSavedDeviceStatusClasses(status) {
        if (status === "online") {
            return "bg-emerald-500";
        }

        if (status === "loading") {
            return "bg-orange-400";
        }

        return "bg-red-500";
    }

    function handleSavedDeviceClick(event, device) {
        const deviceStatus = getSavedDeviceStatus(device.id);

        if (deviceStatus === "offline" || deviceStatus === "loading") {
            event.preventDefault();
            setUnavailableDevice({
                ...device,
                status: deviceStatus,
            });
        }
    }

    async function handleRecentSavedDeviceSelect(device) {
        const deviceStatus = getSavedDeviceStatus(device.id);

        if (deviceStatus === "offline" || deviceStatus === "loading") {
            setUnavailableDevice({
                ...device,
                status: deviceStatus,
            });
            return;
        }

        setOpen(false);
        await router.push(`/app/device/${device.id}`);
    }

    async function refreshSavedDevices() {
        try {
            const response = await fetch("/api/devices");
            const result = await response.json();

            setSavedDevices(Array.isArray(result) ? result : []);
        } catch (error) {
            return;
        }
    }

    const refreshSavedDeviceStatuses = useCallback(async (nextSavedDevices = []) => {
        if (!window?.electron?.listDevices) {
            return;
        }

        const now = Date.now();
        const isCacheFresh =
            savedDeviceStatusLastCheckedAt > 0 &&
            now - savedDeviceStatusLastCheckedAt < DEVICE_STATUS_REFRESH_INTERVAL_MS;

        if (isCacheFresh) {
            setSavedDeviceStatuses(savedDeviceStatusCache);
            setSavedDevicesStatusLoading(false);
            return savedDeviceStatusCache;
        }

        if (savedDeviceStatusInFlightPromise) {
            if (!Object.keys(savedDeviceStatusCache).length) {
                setSavedDevicesStatusLoading(true);
            }
            return savedDeviceStatusInFlightPromise;
        }

        if (!Object.keys(savedDeviceStatusCache).length) {
            setSavedDevicesStatusLoading(true);
        }

        savedDeviceStatusInFlightPromise = (async () => {
            const result = await window.electron.listDevices();
            const detectedDevices = [
                ...(result?.groups?.usb || []),
                ...(result?.groups?.bluetooth || []),
                ...(result?.groups?.network || []),
                ...(result?.connected || []),
            ];
            const nextStatuses = createSavedDeviceStatusMap(nextSavedDevices, detectedDevices);

            savedDeviceStatusCache = nextStatuses;
            savedDeviceStatusLastCheckedAt = Date.now();
            setSavedDeviceStatuses(nextStatuses);
            return nextStatuses;
        })()
            .catch(() => {
                const fallbackStatuses = Object.fromEntries(
                    (nextSavedDevices || []).map((device) => [device.id, "offline"])
                );

                savedDeviceStatusCache = fallbackStatuses;
                savedDeviceStatusLastCheckedAt = Date.now();
                setSavedDeviceStatuses(fallbackStatuses);
                return fallbackStatuses;
            })
            .finally(() => {
                savedDeviceStatusInFlightPromise = null;
                setSavedDevicesStatusLoading(false);
            });

        try {
            return await savedDeviceStatusInFlightPromise;
        } finally {
            setSavedDevicesStatusLoading(false);
        }
    }, []);

    async function handleAddDevice() {
        if (!selectedDevice) {
            return;
        }

        try {
            const response = await fetch("/api/devices", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    sourceKey: selectedDevice.id,
                    alias: deviceAlias.trim() || selectedDevice.name,
                    name: selectedDevice.name,
                    transport: selectedDevice.transport,
                    type: selectedDevice.type,
                    source: selectedDevice.source,
                    path: selectedDevice.path ?? null,
                    address: selectedDevice.address ?? null,
                    port: selectedDevice.port ?? null,
                    protocol: selectedDevice.protocol ?? null,
                    manufacturer: selectedDevice.manufacturer ?? null,
                    serialNumber: selectedDevice.serialNumber ?? null,
                    vendorId: selectedDevice.vendorId ?? null,
                    productId: selectedDevice.productId ?? null,
                    pnpId: selectedDevice.pnpId ?? null,
                }),
            });
            const savedDevice = await response.json();

            addSavedDevice(savedDevice);
            setIsDeviceDetailsOpen(false);
            setSelectedDevice(null);
            setDeviceAlias("");
        } catch (error) {
            return;
        }
    }

    async function handleArchiveDevice(nextDevice = null) {
        const targetDevice = nextDevice || deviceToArchive;

        if (!targetDevice) {
            return;
        }

        try {
            setOpenDeviceMenuId(null);
            await fetch(`/api/devices/${targetDevice.id}`, {
                method: "PATCH",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    archived: true,
                }),
            });

            setDeviceToArchive(null);
            await refreshSavedDevices();
            await router.push("/app/dashboard");
        } catch (error) {
            return;
        }
    }

    function openArchiveDeviceDialog(device) {
        setOpenDeviceMenuId(null);

        if (!archiveConfirmationEnabled) {
            void handleArchiveDevice(device);
            return;
        }

        setDeviceToArchive(device);
    }

    function openDeleteDeviceDialog(device) {
        setOpenDeviceMenuId(null);

        if (!deleteConfirmationEnabled) {
            void handleDeleteDevice(device);
            return;
        }

        setDeviceToDelete(device);
        setDeleteConfirmationValue("");
    }

    function openRenameDeviceDialog(device) {
        setOpenDeviceMenuId(null);
        setDeviceToRename(device);
        setRenameDeviceValue(device.alias || device.name || "");
    }

    async function handleRenameDevice() {
        if (!deviceToRename) {
            return;
        }

        const nextAlias = renameDeviceValue.trim();

        if (!nextAlias) {
            return;
        }

        try {
            await fetch(`/api/devices/${deviceToRename.id}`, {
                method: "PATCH",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    alias: nextAlias,
                }),
            });

            setDeviceToRename(null);
            setRenameDeviceValue("");
            await refreshSavedDevices();
        } catch (error) {
            return;
        }
    }

    async function handleDeleteDevice(nextDevice = null) {
        const targetDevice = nextDevice || deviceToDelete;

        if (!targetDevice) {
            return;
        }

        try {
            const deletedDeviceId = targetDevice.id;

            await fetch(`/api/devices/${deletedDeviceId}`, {
                method: "DELETE",
            });

            setDeviceToDelete(null);
            setDeleteConfirmationValue("");
            await refreshSavedDevices();

            if (router.asPath === `/app/device/${deletedDeviceId}`) {
                await router.push("/app/dashboard");
            }
        } catch (error) {
            return;
        }
    }

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
        let cancelled = false;

        async function loadSavedDevices() {
            try {
                const response = await fetch("/api/devices");
                const result = await response.json();
                const nextSavedDevices = Array.isArray(result) ? result : [];

                if (!cancelled) {
                    setSavedDevices(nextSavedDevices);
                    await refreshSavedDeviceStatuses(nextSavedDevices);
                }
            } catch (error) {
                return;
            }
        }

        loadSavedDevices();

        return () => {
            cancelled = true;
        };
    }, [refreshSavedDeviceStatuses, setSavedDevices]);

    useEffect(() => {
        if (!savedDevicesStatusSignature) {
            savedDeviceStatusCache = {};
            savedDeviceStatusLastCheckedAt = 0;
            setSavedDeviceStatuses({});
            setSavedDevicesStatusLoading(false);
            return;
        }

        if (Object.keys(savedDeviceStatusCache).length) {
            setSavedDeviceStatuses(savedDeviceStatusCache);
            setSavedDevicesStatusLoading(false);
        }

        let intervalId;
        let timeoutId;
        let isDisposed = false;

        async function syncStatuses() {
            if (isDisposed) {
                return;
            }

            await refreshSavedDeviceStatuses(statusTrackedSavedDevicesRef.current);
        }

        const elapsed = savedDeviceStatusLastCheckedAt
            ? Date.now() - savedDeviceStatusLastCheckedAt
            : DEVICE_STATUS_REFRESH_INTERVAL_MS;
        const delay = Math.max(DEVICE_STATUS_REFRESH_INTERVAL_MS - elapsed, 0);

        timeoutId = window.setTimeout(() => {
            syncStatuses();
            intervalId = window.setInterval(syncStatuses, DEVICE_STATUS_REFRESH_INTERVAL_MS);
        }, delay);

        return () => {
            isDisposed = true;
            window.clearTimeout(timeoutId);
            window.clearInterval(intervalId);
        };
    }, [refreshSavedDeviceStatuses, savedDevicesStatusSignature]);

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

    useEffect(() => {
        let cancelled = false;

        async function loadConfirmationSettings() {
            try {
                const [deleteResponse, archiveResponse] = await Promise.all([
                    fetch("/api/app-settings/deleteDeviceConfirmation"),
                    fetch("/api/app-settings/archiveDeviceConfirmation"),
                ]);
                const [deleteResult, archiveResult] = await Promise.all([
                    deleteResponse.json(),
                    archiveResponse.json(),
                ]);

                if (!cancelled) {
                    setDeleteConfirmationEnabled(deleteResult?.value !== "false");
                    setArchiveConfirmationEnabled(archiveResult?.value !== "false");
                }
            } catch (error) {
                return;
            }
        }

        loadConfirmationSettings();

        return () => {
            cancelled = true;
        };
    }, []);

    useEffect(() => {
        if (!open || !isDevicePalette || !window?.electron?.listDevices) {
            return;
        }

        let cancelled = false;

        async function loadDevices() {
            setDevicesState((currentState) => ({
                ...currentState,
                loading: true,
                error: null,
            }));

            try {
                const result = await window.electron.listDevices();

                if (cancelled) {
                    return;
                }

                setDevicesState({
                    loading: false,
                    error: null,
                    connected: result?.connected || [],
                    groups: {
                        usb: result?.groups?.usb || [],
                        bluetooth: result?.groups?.bluetooth || [],
                        network: result?.groups?.network || [],
                    },
                    network: {
                        neighbors: result?.network?.neighbors || [],
                    },
                });
            } catch (error) {
                if (cancelled) {
                    return;
                }

                setDevicesState((currentState) => ({
                    ...currentState,
                    loading: false,
                    error: "Impossibile caricare i device.",
                }));
            }
        }

        loadDevices();

        return () => {
            cancelled = true;
        };
    }, [isDevicePalette, open]);

    if(!session) return null;

    return (
        <div className="h-screen w-full overflow-hidden dark:bg-neutral-800/20 bg-neutrel-50">
            <div
                className="pl-[90px] flex h-11 w-full shrink-0 items-center px-6"
                style={{ WebkitAppRegion: "drag" }}
            >
                <Link href="/app/dashboard" className="absolute font-semibold text-sm w-fit z-50">
                    Placedv
                </Link>
            </div>
            {linkActive("/app/dashboard") || linkActive("/app/device")
                ? <div className="flex h-[calc(100vh-44px)] flex-col justify-between overflow-hidden">
                    <div className="min-h-0 overflow-y-auto">
                        <ul className="p-3 grid gap-1">
                            <CommandDialog
                                open={open}
                                onOpenChange={(nextOpen) => {
                                    setOpen(nextOpen);

                                    if (!nextOpen) {
                                        setPaletteMode("search");
                                    }
                                }}
                            >
                                <Command key={paletteMode} className="dark:bg-neutral-900 bg-neutral-100">
                                    <CommandInput
                                        className="!font-semibold !text-xs !h-10 p-0 flex items-center"
                                        placeholder={isDevicePalette ? "Search devices..." : "Type a command or search..."}
                                        icon={isDevicePalette ? (
                                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4"><path d="m15 18-6-6 6-6"/><path d="M21 12H9"/></svg>
                                        ) : null}
                                        onIconClick={isDevicePalette ? () => setPaletteMode("search") : undefined}
                                    />
                                    <CommandList className="pb-1 border-t border-b dark:border-neutral-800 rounded-t-xl dark:bg-neutral-950/40 bg-white">
                                        {isDevicePalette ? (
                                            <>
                                                {devicesState.error ? (
                                                    <div className="p-3 text-xs font-semibold text-red-500">
                                                        {devicesState.error}
                                                    </div>
                                                ) : null}
                                                <CommandEmpty className="!font-semibold !text-xs p-3">
                                                    Nessun device trovato.
                                                </CommandEmpty>
                                                {devicesState.groups.usb.length ? (
                                                    <CommandGroup heading="USB">
                                                        {devicesState.groups.usb.map((device) => (
                                                            <CommandItem
                                                                key={device.id}
                                                                onSelect={() => handleDetectedDeviceSelect(device)}
                                                                className="cursor-pointer items-center w-full !font-semibold !text-xs min-h-7 rounded-lg flex flex-row gap-2 !py-0"
                                                            >
                                                                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" className="!h-[14px] lucide lucide-hard-drive-icon lucide-hard-drive"><path d="M10 16h.01"/><path d="M2.212 11.577a2 2 0 0 0-.212.896V18a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-5.527a2 2 0 0 0-.212-.896L18.55 5.11A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/><path d="M21.946 12.013H2.054"/><path d="M6 16h.01"/></svg>
                                                                <div className="flex flex-col">
                                                                    <span className="!font-semibold !text-xs">{device.name}</span>
                                                                </div>
                                                            </CommandItem>
                                                        ))}
                                                    </CommandGroup>
                                                ) : null}
                                                {devicesState.groups.bluetooth.length ? (
                                                    <CommandGroup heading="Bluetooth">
                                                        {devicesState.groups.bluetooth.map((device) => (
                                                            <CommandItem
                                                                key={device.id}
                                                                onSelect={() => handleDetectedDeviceSelect(device)}
                                                                className="cursor-pointer items-center w-full !font-semibold !text-xs min-h-7 rounded-lg flex flex-row gap-2 !py-0"
                                                            >
                                                                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" className="!h-[14px] lucide lucide-hard-drive-icon lucide-hard-drive"><path d="M10 16h.01"/><path d="M2.212 11.577a2 2 0 0 0-.212.896V18a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-5.527a2 2 0 0 0-.212-.896L18.55 5.11A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/><path d="M21.946 12.013H2.054"/><path d="M6 16h.01"/></svg>
                                                                <div className="flex flex-col">
                                                                    <span className="!font-semibold !text-xs">{device.name}</span>
                                                                </div>
                                                            </CommandItem>
                                                        ))}
                                                    </CommandGroup>
                                                ) : null}
                                                {devicesState.groups.network.length ? (
                                                    <CommandGroup heading="Network">
                                                        {devicesState.groups.network.map((device) => (
                                                            <CommandItem
                                                                key={device.id}
                                                                onSelect={() => handleDetectedDeviceSelect(device)}
                                                                className="cursor-pointer items-center w-full !font-semibold !text-xs min-h-7 rounded-lg flex flex-row gap-2 !py-0"
                                                            >
                                                                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" className="!h-[14px] lucide lucide-hard-drive-icon lucide-hard-drive"><path d="M10 16h.01"/><path d="M2.212 11.577a2 2 0 0 0-.212.896V18a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-5.527a2 2 0 0 0-.212-.896L18.55 5.11A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/><path d="M21.946 12.013H2.054"/><path d="M6 16h.01"/></svg>
                                                                <div className="flex flex-col">
                                                                    <span className="!font-semibold !text-xs">{device.name}</span>
                                                                </div>
                                                            </CommandItem>
                                                        ))}
                                                    </CommandGroup>
                                                ) : null}
                                            </>
                                        ) : (
                                            <>
                                                <CommandEmpty className="!font-semibold !text-xs p-3">No results found.</CommandEmpty>
                                                <CommandGroup heading="Action">
                                                    <CommandItem
                                                        onSelect={openDevicesPalette}
                                                        className="!font-semibold !text-xs h-7 rounded-lg flex flex-row gap-2 cursor-pointer"
                                                    >
                                                        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" class="!h-[14px] lucide lucide-hard-drive-icon lucide-hard-drive"><path d="M10 16h.01"/><path d="M2.212 11.577a2 2 0 0 0-.212.896V18a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-5.527a2 2 0 0 0-.212-.896L18.55 5.11A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/><path d="M21.946 12.013H2.054"/><path d="M6 16h.01"/></svg>
                                                        Add device
                                                    </CommandItem>
                                                    <CommandItem className="h-7 rounded-lg flex flex-row gap-2">
                                                        <Link href="/app/settings/general" className="items-center w-full !font-semibold !text-xs h-7 rounded-lg flex flex-row gap-2">
                                                            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" className="!h-[14px] lucide lucide-settings-icon lucide-settings"><path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915"/><circle cx="12" cy="12" r="3"/></svg>
                                                            Open settings
                                                        </Link>
                                                    </CommandItem>
                                                </CommandGroup>
                                                {ui?.savedDevices?.length ? (
                                                    <CommandGroup heading="Recent devices">
                                                        {ui.savedDevices.slice(0, 5).map((device) => (
                                                            <CommandItem
                                                                key={device.id}
                                                                onSelect={() => handleRecentSavedDeviceSelect(device)}
                                                                className="cursor-pointer items-center w-full !font-semibold !text-xs min-h-7 rounded-lg flex flex-row gap-2 !py-0"
                                                            >
                                                                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" className="!h-[14px] shrink-0 lucide lucide-hard-drive-icon lucide-hard-drive"><path d="M10 16h.01"/><path d="M2.212 11.577a2 2 0 0 0-.212.896V18a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-5.527a2 2 0 0 0-.212-.896L18.55 5.11A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/><path d="M21.946 12.013H2.054"/><path d="M6 16h.01"/></svg>
                                                                <div className="flex min-w-0 flex-col truncate">
                                                                    <span className="truncate">{device.alias || device.name}</span>
                                                                </div>
                                                            </CommandItem>
                                                        ))}
                                                    </CommandGroup>
                                                ) : null}
                                            </>
                                        )}
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
                                <div
                                    onClick={openSearchPalette}
                                    className={`cursor-pointer font-semibold text-xs flex justify-between items-center gap-3 p-1.5 px-2 hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded-lg`}
                                >
                                    <div className="flex flex-row items-center gap-3">
                                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-search-icon lucide-search"><path d="m21 21-4.34-4.34"/><circle cx="11" cy="11" r="8"/></svg>
                                        Search
                                    </div>
                                    <Badge variant="secondary" className="p-0 px-1.5 text-[10px] h-fit font-semibold dark:bg-neutral-700/50 bg-neutral-200/50">
                                        ⌘K
                                    </Badge>
                                </div>
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
                        <div className="px-3 pb-3">
                            <div className="flex flex-row items-center justify-between">
                                <h2 className="font-semibold !text-xs text-neutral-400">
                                    Devices
                                </h2>
                                <div
                                    onClick={openDevicesPalette}
                                    className="text-neutral-400 hover:text-black p-1 hover:bg-neutral-100 rounded-md cursor-pointer"
                                >
                                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" class="!h-[14px] !w-[14px] lucide lucide-folder-plus-icon lucide-folder-plus"><path d="M12 10v6"/><path d="M9 13h6"/><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/></svg>
                                </div>
                            </div>
                            {ui?.savedDevices?.length ? (
                                <ul className="mt-2 grid gap-1">
                                    {ui.savedDevices.map((device) => (
                                        <li key={device.id} className="group truncate">
                                            <div className={`relative rounded-lg ${router.asPath === `/app/device/${device.id}` || openDeviceMenuId === device.id ? `bg-neutral-100 dark:bg-neutral-800` : `hover:bg-neutral-100 dark:hover:bg-neutral-800`}`}>
                                                <Link
                                                    href={`/app/device/${device.id}`}
                                                    className="flex min-w-0 items-center gap-3 truncate rounded-lg p-1.5 pr-10 text-xs font-semibold"
                                                    onClick={(event) => handleSavedDeviceClick(event, device)}
                                                >
                                                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" className="!max-h-[16px] !min-h-[16px] !h-[16px] shrink-0 lucide lucide-hard-drive-icon lucide-hard-drive"><path d="M10 16h.01"/><path d="M2.212 11.577a2 2 0 0 0-.212.896V18a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-5.527a2 2 0 0 0-.212-.896L18.55 5.11A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/><path d="M21.946 12.013H2.054"/><path d="M6 16h.01"/></svg>
                                                    <span
                                                        className={`h-2 w-2 shrink-0 rounded-full ${getSavedDeviceStatusClasses(getSavedDeviceStatus(device.id))}`}
                                                        aria-hidden="true"
                                                    />
                                                    <div className="flex min-w-0 flex-col truncate">
                                                        <span className="truncate">{device.alias || device.name}</span>
                                                    </div>
                                                </Link>
                                                <DropdownMenu
                                                    open={openDeviceMenuId === device.id}
                                                    onOpenChange={(isOpen) => {
                                                        setOpenDeviceMenuId(isOpen ? device.id : null);
                                                    }}
                                                >
                                                    <DropdownMenuTrigger asChild>
                                                        <button
                                                            type="button"
                                                            aria-label={`Azioni per ${device.alias || device.name}`}
                                                            className={`absolute right-1 top-1/2 z-10 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-neutral-400 transition-opacity hover:text-neutral-700 focus-visible:outline-none dark:hover:text-neutral-100 ${openDeviceMenuId === device.id ? `opacity-100` : `opacity-0 group-hover:opacity-100 focus-visible:opacity-100`}`}
                                                        >
                                                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></svg>
                                                        </button>
                                                    </DropdownMenuTrigger>
                                                    <DropdownMenuContent side="right" align="start" className="w-[180px]">
                                                        <DropdownMenuItem
                                                            onClick={() => openRenameDeviceDialog(device)}
                                                            className="cursor-pointer font-semibold !text-xs gap-1"
                                                        >
                                                            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="!h-[14px] lucide lucide-square-pen-icon lucide-square-pen"><path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z"/></svg>
                                                            Rename device
                                                        </DropdownMenuItem>
                                                        <DropdownMenuItem
                                                            onClick={() => openArchiveDeviceDialog(device)}
                                                            className="cursor-pointer font-semibold !text-xs gap-1"
                                                        >
                                                            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="!h-[14px] lucide lucide-archive-icon lucide-archive"><rect width="20" height="5" x="2" y="3" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/><path d="M10 12h4"/></svg>
                                                            Archivia device
                                                        </DropdownMenuItem>
                                                        <DropdownMenuItem
                                                            onClick={() => openDeleteDeviceDialog(device)}
                                                            className="cursor-pointer font-semibold text-red-600 focus:text-red-600 !text-xs gap-1"
                                                        >
                                                            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="!h-[14px] lucide lucide-trash-icon lucide-trash"><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                                                            Elimina device
                                                        </DropdownMenuItem>
                                                    </DropdownMenuContent>
                                                </DropdownMenu>
                                            </div>
                                        </li>
                                    ))}
                                </ul>
                            ) : null}
                        </div>
                    </div>
                    <ul className="shrink-0 p-3 grid gap-1">
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
                : <div className="flex h-[calc(100vh-44px)] flex-col justify-between overflow-hidden">
                    <ul className="overflow-y-auto p-3 grid gap-1">
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
                    <ul className="shrink-0 p-3 grid gap-1">
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

            <Dialog open={isDeviceDetailsOpen} onOpenChange={setIsDeviceDetailsOpen}>
                <DialogContent className="sm:max-w-md p-3">
                    <DialogHeader>
                        <DialogTitle className="font-semibold text-sm">Add device</DialogTitle>
                        <DialogDescription className="font-semibold text-xs">
                            Conferma le informazioni del device prima di aggiungerlo alla lista.
                        </DialogDescription>
                    </DialogHeader>
                    {selectedDevice ? (
                        <div className="grid gap-4 text-xs font-semibold">
                            <div className="grid gap-2">
                                <label htmlFor="device-alias" className="text-neutral-500">Device name</label>
                                <Input
                                    id="device-alias"
                                    value={deviceAlias}
                                    onChange={(event) => setDeviceAlias(event.target.value)}
                                    className="h-7 p-0 rounded-lg border border-neutral-200 bg-white px-3 text-xs font-semibold outline-none dark:border-neutral-800 dark:bg-neutral-900"
                                    placeholder="Arduino banco test"
                                />
                            </div>
                        </div>
                    ) : null}
                    <DialogFooter>
                        <Button
                            onClick={() => setIsDeviceDetailsOpen(!isDeviceDetailsOpen)}
                            className="rounded-lg h-7 !font-semibold !text-xs border bg-white hover:bg-neutral-50 text-black dark:text-white dark:bg-neutral-800 dark:border-neutral-700"
                        >
                            Cancel
                        </Button>
                        <Button
                            onClick={handleAddDevice}
                            type="button"
                            className="rounded-lg h-7 !font-semibold !text-xs border bg-blue-600 hover:bg-blue-700 border-blue-800 text-white dark:text-white dark:bg-neutral-800 dark:border-neutral-700"
                        >
                            Add device
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
            <Dialog
                open={Boolean(deviceToRename)}
                onOpenChange={(nextOpen) => {
                    if (!nextOpen) {
                        setDeviceToRename(null);
                        setRenameDeviceValue("");
                    }
                }}
            >
                <DialogContent className="sm:max-w-md p-3">
                    <DialogHeader>
                        <DialogTitle className="font-semibold text-sm">
                            Rename {deviceToRename?.alias || deviceToRename?.name}
                        </DialogTitle>
                        <DialogDescription className="font-semibold text-xs">
                            Inserisci il nuovo nome da mostrare nella navigation bar.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-4 text-xs font-semibold">
                        <div className="grid gap-2">
                            <label htmlFor="rename-device-input" className="text-neutral-500">Nome device</label>
                            <Input
                                id="rename-device-input"
                                value={renameDeviceValue}
                                onChange={(event) => setRenameDeviceValue(event.target.value)}
                                className="h-7 p-0 rounded-lg border-0 border-neutral-200 ring-1 ring-neutral-200 dark:ring-neutral-700 bg-white dark:bg-neutral-800 px-3 text-xs font-semibold outline-none dark:border-neutral-800 focus-visible:ring-blue-500 dark:focus-visible:ring-blue-500"
                                placeholder="Arduino banco test"
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button
                            onClick={() => {
                                setDeviceToRename(null);
                                setRenameDeviceValue("");
                            }}
                            className="rounded-lg h-7 !font-semibold !text-xs border bg-white hover:bg-neutral-50 text-black dark:text-white dark:bg-neutral-800 dark:border-neutral-700"
                        >
                            Cancel
                        </Button>
                        <Button
                            onClick={handleRenameDevice}
                            type="button"
                            disabled={!renameDeviceValue.trim() || renameDeviceValue.trim() === (deviceToRename?.alias || deviceToRename?.name)}
                            className="rounded-lg h-7 !font-semibold !text-xs border bg-blue-600 hover:bg-blue-700 border-blue-800 text-white dark:text-white dark:bg-neutral-800 dark:border-neutral-700"
                        >
                            Save
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
            <Dialog
                open={Boolean(deviceToArchive)}
                onOpenChange={(nextOpen) => {
                    if (!nextOpen) {
                        setDeviceToArchive(null);
                    }
                }}
            >
                <DialogContent className="sm:max-w-md p-3">
                    <DialogHeader>
                        <DialogTitle className="font-semibold text-sm">
                            Archive {deviceToArchive?.alias || deviceToArchive?.name}
                        </DialogTitle>
                        <DialogDescription className="font-semibold text-xs">
                            Conferma se vuoi archiviare questo device.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button
                            onClick={() => {
                                setDeviceToArchive(null);
                            }}
                            className="rounded-lg h-7 !font-semibold !text-xs border bg-white hover:bg-neutral-50 text-black dark:text-white dark:bg-neutral-800 dark:border-neutral-700"
                        >
                            Cancel
                        </Button>
                        <Button
                            onClick={() => handleArchiveDevice()}
                            type="button"
                            className="rounded-lg h-7 !font-semibold !text-xs border border-blue-700 bg-blue-600 hover:bg-blue-700 text-white disabled:border-blue-300 disabled:bg-blue-300"
                        >
                            Archive
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
            <Dialog
                open={Boolean(deviceToDelete)}
                onOpenChange={(nextOpen) => {
                    if (!nextOpen) {
                        setDeviceToDelete(null);
                        setDeleteConfirmationValue("");
                    }
                }}
            >
                <DialogContent className="sm:max-w-md p-3">
                    <DialogHeader>
                        <DialogTitle className="font-semibold text-sm">
                            Delete {deviceToDelete?.alias || deviceToDelete?.name}
                        </DialogTitle>
                        <DialogDescription className="font-semibold text-xs">
                            Digita il nome del device per abilitare il bottone di eliminazione.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-4 text-xs font-semibold">
                        <div className="grid gap-2">
                            <label htmlFor="delete-device-confirmation" className="text-neutral-500">Nome device</label>
                            <Input
                                id="delete-device-confirmation"
                                value={deleteConfirmationValue}
                                onChange={(event) => setDeleteConfirmationValue(event.target.value)}
                                className="h-7 p-0 rounded-lg border-0 border-neutral-200 ring-1 ring-neutral-200 dark:ring-neutral-700 bg-white dark:bg-neutral-800 px-3 text-xs font-semibold outline-none dark:border-neutral-800 focus-visible:ring-blue-500 dark:focus-visible:ring-blue-500"
                                placeholder="Digita il nome del device"
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button
                            onClick={() => {
                                setDeviceToDelete(null);
                                setDeleteConfirmationValue("");
                            }}
                            className="rounded-lg h-7 !font-semibold !text-xs border bg-white hover:bg-neutral-50 text-black dark:text-white dark:bg-neutral-800 dark:border-neutral-700"
                        >
                            Cancel
                        </Button>
                        <Button
                            onClick={() => handleDeleteDevice()}
                            type="button"
                            disabled={deleteConfirmationValue !== (deviceToDelete?.alias || deviceToDelete?.name)}
                            className="rounded-lg h-7 !font-semibold !text-xs border border-red-700 bg-red-600 hover:bg-red-700 text-white disabled:border-red-300 disabled:bg-red-300"
                        >
                            Delete
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
            <Dialog
                open={Boolean(unavailableDevice)}
                onOpenChange={(nextOpen) => {
                    if (!nextOpen) {
                        setUnavailableDevice(null);
                    }
                }}
            >
                <DialogContent className="sm:max-w-md p-3">
                    <DialogHeader>
                        <DialogTitle className="font-semibold text-sm">
                            {unavailableDevice?.status === "loading" ? "Device loading" : "Device offline"}
                        </DialogTitle>
                        <DialogDescription className="font-semibold text-xs">
                            {unavailableDevice?.status === "loading"
                                ? `${unavailableDevice?.alias || unavailableDevice?.name} e ancora in fase di verifica. Attendi qualche secondo e riprova.`
                                : `${unavailableDevice?.alias || unavailableDevice?.name} non e disponibile in questo momento. Verifica la connessione del device e riprova.`}
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button
                            onClick={() => setUnavailableDevice(null)}
                            className="rounded-lg h-7 !font-semibold !text-xs border bg-white hover:bg-neutral-50 text-black dark:text-white dark:bg-neutral-800 dark:border-neutral-700"
                        >
                            OK
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}

const mapStateToProps = (state) => {
    return {
        profile: state.profile,
        ui: state.ui,
    };
};

const mapDispatchToProps = {
    setProfile,
    addSavedDevice,
    setSavedDevices,
};

export default connect(mapStateToProps, mapDispatchToProps)(NavigationBar);
