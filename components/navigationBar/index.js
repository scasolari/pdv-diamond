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

const DEVICE_STATUS_REFRESH_INTERVAL_MS = 3000;
const DEVICE_STATUS_MISS_THRESHOLD = 3;
const DEVICE_PALETTE_REFRESH_INTERVAL_MS = 2500;
const PENDING_UNAVAILABLE_DEVICE_KEY = "pending_unavailable_device";
let savedDeviceStatusCache = {};
let savedDeviceAvailabilityCache = {};
let savedDeviceStatusLastCheckedAt = 0;
let savedDeviceStatusInFlightPromise = null;
let savedDeviceStatusMisses = {};

function buildSavedDeviceSourceKey(device) {
    if (!device) {
        return "";
    }

    return [
        device.sourceKey,
        device.path,
        device.address,
        device.serialNumber,
        device.pnpId,
        device.mac,
        device.interface,
        device.protocol && device.address ? `${device.protocol}:${device.address}` : "",
        device.vendorId && device.productId ? `${device.vendorId}:${device.productId}` : "",
    ]
        .filter(Boolean)
        .join("|");
}

function normalizeMatchValue(value) {
    return String(value || "")
        .trim()
        .toLowerCase();
}

function normalizeDeviceNameForMatch(value) {
    return normalizeMatchValue(value).replace(/[^a-z0-9]/g, "");
}

function isArduinoLikeDevice(device) {
    const searchable = [
        device?.alias,
        device?.name,
        device?.manufacturer,
        device?.path,
    ]
        .map(normalizeDeviceNameForMatch)
        .join(" ");

    return searchable.includes("arduino");
}

function normalizeDevicePathForMatch(value) {
    return normalizeMatchValue(value)
        .replace(/^serial:/, "")
        .replace(/^\/dev\//, "")
        .replace(/^(tty\.|cu\.)/, "");
}

function buildVendorProductKey(device) {
    if (!device?.vendorId || !device?.productId) {
        return "";
    }

    return `${normalizeMatchValue(device.vendorId)}:${normalizeMatchValue(device.productId)}`;
}

function isSavedDeviceMatchedByDetection(savedDevice, detectedDevice) {
    const savedSourceKey = normalizeMatchValue(savedDevice?.sourceKey);
    const detectedId = normalizeMatchValue(detectedDevice?.id);
    const savedPath = normalizeMatchValue(savedDevice?.path);
    const detectedPath = normalizeMatchValue(detectedDevice?.path);
    const savedAddress = normalizeMatchValue(savedDevice?.address);
    const detectedAddress = normalizeMatchValue(detectedDevice?.address);
    const savedSerialNumber = normalizeMatchValue(savedDevice?.serialNumber);
    const detectedSerialNumber = normalizeMatchValue(detectedDevice?.serialNumber);
    const savedPnpId = normalizeMatchValue(savedDevice?.pnpId);
    const detectedPnpId = normalizeMatchValue(detectedDevice?.pnpId);
    const savedMac = normalizeMatchValue(savedDevice?.mac);
    const detectedMac = normalizeMatchValue(detectedDevice?.mac);
    const savedInterface = normalizeMatchValue(savedDevice?.interface);
    const detectedInterface = normalizeMatchValue(detectedDevice?.interface);
    const savedProtocolAddress = normalizeMatchValue(
        savedDevice?.protocol && savedDevice?.address ? `${savedDevice.protocol}:${savedDevice.address}` : ""
    );
    const detectedProtocolAddress = normalizeMatchValue(
        detectedDevice?.protocol && detectedDevice?.address ? `${detectedDevice.protocol}:${detectedDevice.address}` : ""
    );
    const savedVendorProduct = buildVendorProductKey(savedDevice);
    const detectedVendorProduct = buildVendorProductKey(detectedDevice);
    const savedNormalizedPath = normalizeDevicePathForMatch(savedDevice?.path || savedDevice?.sourceKey);
    const detectedNormalizedPath = normalizeDevicePathForMatch(detectedDevice?.path || detectedDevice?.id);
    const savedNormalizedName = normalizeDeviceNameForMatch(savedDevice?.name || savedDevice?.alias);
    const detectedNormalizedName = normalizeDeviceNameForMatch(detectedDevice?.name || detectedDevice?.manufacturer);
    const savedManufacturer = normalizeDeviceNameForMatch(savedDevice?.manufacturer);
    const detectedManufacturer = normalizeDeviceNameForMatch(detectedDevice?.manufacturer);

    return (
        (savedSourceKey && detectedId && savedSourceKey === detectedId) ||
        (savedPath && detectedPath && savedPath === detectedPath) ||
        (savedAddress && detectedAddress && savedAddress === detectedAddress) ||
        (savedSerialNumber && detectedSerialNumber && savedSerialNumber === detectedSerialNumber) ||
        (savedPnpId && detectedPnpId && savedPnpId === detectedPnpId) ||
        (savedMac && detectedMac && savedMac === detectedMac) ||
        (savedInterface && detectedInterface && savedInterface === detectedInterface) ||
        (savedProtocolAddress && detectedProtocolAddress && savedProtocolAddress === detectedProtocolAddress) ||
        (savedVendorProduct && detectedVendorProduct && savedVendorProduct === detectedVendorProduct) ||
        (savedNormalizedPath && detectedNormalizedPath && savedNormalizedPath === detectedNormalizedPath) ||
        (
            savedVendorProduct &&
            detectedVendorProduct &&
            savedVendorProduct === detectedVendorProduct &&
            (
                (savedManufacturer && detectedManufacturer && savedManufacturer === detectedManufacturer) ||
                (savedNormalizedName && detectedNormalizedName && savedNormalizedName === detectedNormalizedName)
            )
        )
    );
}

function findPreferredDetectedSibling(savedDevice, detectedDevices) {
    if (!savedDevice || !isArduinoLikeDevice(savedDevice)) {
        return null;
    }

    const candidates = (detectedDevices || []).filter((detectedDevice) => {
        if (!isArduinoLikeDevice(detectedDevice)) {
            return false;
        }

        if (savedDevice?.address && detectedDevice?.path) {
            return true;
        }

        if (savedDevice?.path && detectedDevice?.address) {
            return true;
        }

        return false;
    });

    if (candidates.length === 1) {
        return candidates[0];
    }

    return null;
}

function createSavedDeviceStatusMap(savedDevices, detectedDevices) {
    return Object.fromEntries(
        (savedDevices || []).map((device) => {
            const detectedMatch = (detectedDevices || []).find((detectedDevice) =>
                isSavedDeviceMatchedByDetection(device, detectedDevice)
            );
            const preferredSibling = detectedMatch
                ? null
                : findPreferredDetectedSibling(device, detectedDevices);
            const isOnline = Boolean(detectedMatch || preferredSibling);

            return [device.id, isOnline ? "online" : "offline"];
        })
    );
}

function mapConnectionStateToStatus(connectionState) {
    if (connectionState?.state === "connected") {
        return "online";
    }

    if (connectionState?.state === "connecting") {
        return "loading";
    }

    return "offline";
}

function isActiveConnectionState(connectionState) {
    return connectionState?.state === "connected" || connectionState?.state === "connecting";
}

function buildSavedDevicesStatusSignature(savedDevices) {
    return (savedDevices || [])
        .map((device) => [
            device.id,
            device.sourceKey,
            device.path,
            device.address,
            device.sshUser,
            device.sshPort,
            device.serialNumber,
            device.pnpId,
            device.mac,
            device.interface,
            device.protocol,
            device.vendorId,
            device.productId,
        ].join("|"))
        .sort()
        .join("::");
}

function mergeDetectedAndSavedNetworkDevices(detectedDevices, savedDevices) {
    const nextDetectedDevices = Array.isArray(detectedDevices) ? detectedDevices : [];
    const nextSavedDevices = Array.isArray(savedDevices) ? savedDevices : [];
    const mergedDevices = [...nextDetectedDevices];
    const seenKeys = new Set(
        mergedDevices.flatMap((device) => [
            device?.id,
            device?.sourceKey,
            device?.address ? `address:${normalizeMatchValue(device.address)}` : null,
        ].filter(Boolean))
    );

    nextSavedDevices
        .filter((device) => !device?.archivedAt)
        .filter((device) => device?.transport === "network" || device?.type === "network" || device?.address)
        .forEach((device) => {
            const candidateKeys = [
                device?.id,
                device?.sourceKey,
                device?.address ? `address:${normalizeMatchValue(device.address)}` : null,
            ].filter(Boolean);

            if (candidateKeys.some((key) => seenKeys.has(key))) {
                return;
            }

            mergedDevices.push({
                id: device.id || device.sourceKey || `saved-network:${device.address || device.alias || device.name}`,
                name: device.alias || device.name || device.address || "Network device",
                address: device.address || null,
                port: device.port || null,
                protocol: device.protocol || "ssh",
                transport: "network",
                type: "network",
                source: device.source || "saved",
                sourceKey: device.sourceKey || null,
                mac: device.mac || null,
                interface: device.interface || null,
                savedDeviceId: device.id || null,
            });

            candidateKeys.forEach((key) => seenKeys.add(key));
        });

    return mergedDevices.sort((left, right) => String(left?.name || "").localeCompare(String(right?.name || "")));
}

function flattenDetectedDevices(result) {
    return [
        ...(result?.groups?.usb || []),
        ...(result?.groups?.network || []),
        ...(result?.connected || []),
    ];
}

function NavigationBar(props) {
    const { profile, setProfile, ui, addSavedDevice, setSavedDevices } = props;
    const [open, setOpen] = useState(false)
    const [paletteMode, setPaletteMode] = useState("search")
    const [isMissionDialogOpen, setIsMissionDialogOpen] = useState(false)
    const [missionName, setMissionName] = useState("")
    const [missionSelectedDeviceId, setMissionSelectedDeviceId] = useState("")
    const [missionDetectedDevices, setMissionDetectedDevices] = useState([])
    const [missionDetectedDevicesLoading, setMissionDetectedDevicesLoading] = useState(false)
    const [missionDetectedDevicesError, setMissionDetectedDevicesError] = useState("")
    const [missionSelectedDetectedDeviceId, setMissionSelectedDetectedDeviceId] = useState("")
    const [missionSshUser, setMissionSshUser] = useState("arduino")
    const [missionSshPassword, setMissionSshPassword] = useState("")
    const [missionDirectories, setMissionDirectories] = useState([])
    const [missionRemoteFiles, setMissionRemoteFiles] = useState([])
    const [missionRemotePath, setMissionRemotePath] = useState("")
    const [missionDirectoriesLoading, setMissionDirectoriesLoading] = useState(false)
    const [missionDirectoriesError, setMissionDirectoriesError] = useState("")
    const [missionAuthRequired, setMissionAuthRequired] = useState(false)
    const [missionNewDirectoryName, setMissionNewDirectoryName] = useState("")
    const [missionFiles, setMissionFiles] = useState([])
    const [missionEntrypoint, setMissionEntrypoint] = useState("")
    const [missionNotes, setMissionNotes] = useState("")
    const [missionSubmitError, setMissionSubmitError] = useState("")
    const [missionSubmitting, setMissionSubmitting] = useState(false)
    const [selectedDevice, setSelectedDevice] = useState(null)
    const [isDeviceDetailsOpen, setIsDeviceDetailsOpen] = useState(false)
    const [deviceAlias, setDeviceAlias] = useState("")
    const [deviceSshUser, setDeviceSshUser] = useState("arduino")
    const [deviceSshPort, setDeviceSshPort] = useState("22")
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
    const [savedDeviceAvailability, setSavedDeviceAvailability] = useState({})
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

    useEffect(() => {
        if (typeof window === "undefined") {
            return;
        }

        const rawPendingUnavailableDevice = window.localStorage.getItem(PENDING_UNAVAILABLE_DEVICE_KEY);

        if (!rawPendingUnavailableDevice) {
            return;
        }

        try {
            const pendingUnavailableDevice = JSON.parse(rawPendingUnavailableDevice);

            if (pendingUnavailableDevice) {
                setUnavailableDevice(pendingUnavailableDevice);
            }
        } catch (error) {
            return;
        } finally {
            window.localStorage.removeItem(PENDING_UNAVAILABLE_DEVICE_KEY);
        }
    }, [router.asPath]);

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
            sshUser: device.sshUser,
            sshPort: device.sshPort,
            serialNumber: device.serialNumber,
            pnpId: device.pnpId,
            mac: device.mac,
            interface: device.interface,
            protocol: device.protocol,
            vendorId: device.vendorId,
            productId: device.productId,
        })),
        [ui?.savedDevices]
    );
    const missionSelectedSavedDevice = useMemo(
        () => (ui?.savedDevices || []).find((device) => device.id === missionSelectedDeviceId) || null,
        [missionSelectedDeviceId, ui?.savedDevices]
    );
    const missionResolvedDevice = useMemo(() => {
        if (!missionSelectedSavedDevice) {
            return null;
        }

        const detectedMatch = missionDetectedDevices.find((detectedDevice) =>
            isSavedDeviceMatchedByDetection(missionSelectedSavedDevice, detectedDevice)
        );
        const preferredSibling = detectedMatch
            ? null
            : findPreferredDetectedSibling(missionSelectedSavedDevice, missionDetectedDevices);
        const resolvedDevice = detectedMatch || preferredSibling;

        if (!resolvedDevice) {
            return missionSelectedSavedDevice;
        }

        return {
            ...missionSelectedSavedDevice,
            address: resolvedDevice.address ?? missionSelectedSavedDevice.address ?? null,
            port: resolvedDevice.port ?? missionSelectedSavedDevice.port ?? null,
            protocol: resolvedDevice.protocol ?? missionSelectedSavedDevice.protocol ?? null,
            path: resolvedDevice.path ?? missionSelectedSavedDevice.path ?? null,
        };
    }, [missionDetectedDevices, missionSelectedSavedDevice]);
    const missionEntrypointOptions = useMemo(() => {
        const optionNames = new Set();

        missionRemoteFiles.forEach((file) => {
            if (file?.name) {
                optionNames.add(file.name);
            }
        });

        missionFiles.forEach((file) => {
            if (file?.name) {
                optionNames.add(file.name);
            }
        });

        return Array.from(optionNames);
    }, [missionFiles, missionRemoteFiles]);
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

    useEffect(() => {
        function handleSearchShortcut(event) {
            const isShortcut = (event.metaKey || event.ctrlKey) && event.key?.toLowerCase() === "k";

            if (!isShortcut) {
                return;
            }

            event.preventDefault();
            openSearchPalette();
        }

        window.addEventListener("keydown", handleSearchShortcut);

        return () => {
            window.removeEventListener("keydown", handleSearchShortcut);
        };
    }, []);

    function resetMissionDialogState() {
        setMissionName("");
        setMissionSelectedDeviceId("");
        setMissionDetectedDevices([]);
        setMissionDetectedDevicesLoading(false);
        setMissionDetectedDevicesError("");
        setMissionSelectedDetectedDeviceId("");
        setMissionSshUser("arduino");
        setMissionSshPassword("");
        setMissionDirectories([]);
        setMissionRemoteFiles([]);
        setMissionRemotePath("");
        setMissionDirectoriesLoading(false);
        setMissionDirectoriesError("");
        setMissionAuthRequired(false);
        setMissionNewDirectoryName("");
        setMissionFiles([]);
        setMissionEntrypoint("");
        setMissionNotes("");
        setMissionSubmitError("");
        setMissionSubmitting(false);
    }

    function closeMissionDialog() {
        setIsMissionDialogOpen(false);
        resetMissionDialogState();
    }

    async function persistDetectedDevice(device, aliasOverride, sshOptions = {}) {
        const nextSshUser = String(sshOptions.sshUser ?? deviceSshUser ?? "").trim();
        const nextSshPort = Number(sshOptions.sshPort ?? deviceSshPort);

        const response = await fetch("/api/devices", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                sourceKey: device.id,
                alias: aliasOverride?.trim() || device.name,
                name: device.name,
                transport: device.transport,
                type: device.type,
                source: device.source,
                path: device.path ?? null,
                address: device.address ?? null,
                port: device.port ?? null,
                sshUser: nextSshUser || null,
                sshPort: Number.isInteger(nextSshPort) && nextSshPort > 0 ? nextSshPort : null,
                protocol: device.protocol ?? null,
                manufacturer: device.manufacturer ?? null,
                serialNumber: device.serialNumber ?? null,
                vendorId: device.vendorId ?? null,
                productId: device.productId ?? null,
                pnpId: device.pnpId ?? null,
                mac: device.mac ?? null,
                interface: device.interface ?? null,
            }),
        });
        const savedDevice = await response.json();

        if (!response.ok) {
            throw new Error(savedDevice?.message || "Unable to save detected device.");
        }

        await refreshSavedDevices();
        return savedDevice;
    }

    async function loadMissionDetectedDevices() {
        if (!window?.electron?.listDevices) {
            return;
        }

        setMissionDetectedDevicesLoading(true);
        setMissionDetectedDevicesError("");

        try {
            const result = await window.electron.listDevices();
            setMissionDetectedDevices(flattenDetectedDevices(result));
        } catch (error) {
            setMissionDetectedDevicesError("Unable to load detected devices.");
        } finally {
            setMissionDetectedDevicesLoading(false);
        }
    }

    async function handleMissionBrowseDirectories(nextPath = null) {
        if (!window?.electron?.listMissionRemoteDirectories) {
            return;
        }

        if (!missionResolvedDevice?.address) {
            setMissionDirectories([]);
            setMissionDirectoriesError("This device does not expose an SSH address for remote mission folders.");
            setMissionAuthRequired(false);
            return;
        }

        setMissionDirectoriesLoading(true);
        setMissionDirectoriesError("");
        setMissionSubmitError("");
        setMissionAuthRequired(false);

        try {
            const result = await window.electron.listMissionRemoteDirectories({
                id: missionResolvedDevice.id,
                address: missionResolvedDevice.address,
                port: missionResolvedDevice.port ?? undefined,
                sshUser: missionSshUser.trim() || "arduino",
                password: missionSshPassword || undefined,
                remotePath: nextPath || missionRemotePath || undefined,
            });

            if (result?.authRequired) {
                setMissionAuthRequired(true);
                setMissionDirectories([]);
                setMissionRemoteFiles([]);
                setMissionDirectoriesError("SSH authentication is required to read remote folders.");
                return;
            }

            const nextRemoteFiles = result?.files || [];
            setMissionDirectories(result?.directories || []);
            setMissionRemoteFiles(nextRemoteFiles);
            setMissionRemotePath(result?.remotePath || nextPath || missionRemotePath);
            setMissionEntrypoint((currentEntrypoint) => {
                const nextOptionNames = new Set([
                    ...nextRemoteFiles.map((file) => file?.name).filter(Boolean),
                    ...missionFiles.map((file) => file?.name).filter(Boolean),
                ]);

                if (currentEntrypoint && nextOptionNames.has(currentEntrypoint)) {
                    return currentEntrypoint;
                }

                const mainRemoteFile = nextRemoteFiles.find((file) => file?.name === "main.py");
                if (mainRemoteFile?.name) {
                    return mainRemoteFile.name;
                }

                const firstRemoteFile = nextRemoteFiles[0]?.name;
                if (firstRemoteFile) {
                    return firstRemoteFile;
                }

                const mainUploadedFile = missionFiles.find((file) => file?.name === "main.py");
                if (mainUploadedFile?.name) {
                    return mainUploadedFile.name;
                }

                return missionFiles[0]?.name || "";
            });
        } catch (error) {
            setMissionDirectories([]);
            setMissionRemoteFiles([]);
            setMissionDirectoriesError(error?.message || "Unable to read remote folders.");
        } finally {
            setMissionDirectoriesLoading(false);
        }
    }

    async function handleMissionCreateDirectory() {
        if (!window?.electron?.createMissionRemoteDirectory) {
            return;
        }

        if (!missionResolvedDevice?.address) {
            setMissionDirectoriesError("This device does not expose an SSH address for remote mission folders.");
            return;
        }

        const directoryName = missionNewDirectoryName.trim();

        if (!directoryName) {
            setMissionDirectoriesError("Enter a new directory name.");
            return;
        }

        setMissionDirectoriesLoading(true);
        setMissionDirectoriesError("");
        setMissionSubmitError("");
        setMissionAuthRequired(false);

        try {
            const result = await window.electron.createMissionRemoteDirectory({
                id: missionResolvedDevice.id,
                address: missionResolvedDevice.address,
                port: missionResolvedDevice.port ?? undefined,
                sshUser: missionSshUser.trim() || "arduino",
                password: missionSshPassword || undefined,
                parentPath: missionRemotePath,
                directoryName,
            });

            if (result?.authRequired) {
                setMissionAuthRequired(true);
                setMissionDirectoriesError("SSH authentication is required to create remote folders.");
                return;
            }

            setMissionNewDirectoryName("");
            await handleMissionBrowseDirectories(result?.remotePath || missionRemotePath);
        } catch (error) {
            setMissionDirectoriesError(error?.message || "Unable to create the remote folder.");
        } finally {
            setMissionDirectoriesLoading(false);
        }
    }

    function handleMissionFilesChange(event) {
        const nextFiles = Array.from(event.target.files || []).filter((file) =>
            String(file?.name || "").toLowerCase().endsWith(".py")
        );

        setMissionFiles(nextFiles);

        if (!nextFiles.length) {
            setMissionEntrypoint((currentEntrypoint) => {
                if (currentEntrypoint && missionRemoteFiles.some((file) => file.name === currentEntrypoint)) {
                    return currentEntrypoint;
                }

                const mainRemoteFile = missionRemoteFiles.find((file) => file.name === "main.py");
                return mainRemoteFile?.name || missionRemoteFiles[0]?.name || "";
            });
            return;
        }

        setMissionEntrypoint((currentEntrypoint) => {
            if (
                currentEntrypoint &&
                (nextFiles.some((file) => file.name === currentEntrypoint) ||
                    missionRemoteFiles.some((file) => file.name === currentEntrypoint))
            ) {
                return currentEntrypoint;
            }

            const mainFile = nextFiles.find((file) => file.name === "main.py");
            return mainFile?.name || nextFiles[0].name;
        });
    }

    function readFileAsBase64(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();

            reader.onload = () => {
                const result = String(reader.result || "");
                const dataBase64 = result.includes(",") ? result.split(",").pop() : "";
                resolve(dataBase64 || "");
            };

            reader.onerror = () => {
                reject(new Error(`Unable to read ${file?.name || "file"}.`));
            };

            reader.readAsDataURL(file);
        });
    }

    async function handleCreateMission() {
        const name = missionName.trim();
        const deviceId = missionSelectedDeviceId;
        const remotePath = missionRemotePath.trim();
        const entrypoint = missionEntrypoint.trim();

        if (!name || !deviceId || !remotePath || !entrypoint) {
            setMissionSubmitError("Name, device, remote folder, and entrypoint are required.");
            return;
        }

        if (!missionResolvedDevice?.address) {
            setMissionSubmitError("This device does not expose an SSH address for mission management.");
            return;
        }

        setMissionSubmitting(true);
        setMissionSubmitError("");
        setMissionAuthRequired(false);

        try {
            if (missionFiles.length && window?.electron?.uploadMissionFiles) {
                const filesPayload = await Promise.all(
                    missionFiles.map(async (file) => ({
                        name: file.name,
                        dataBase64: await readFileAsBase64(file),
                    }))
                );

                const uploadResult = await window.electron.uploadMissionFiles({
                    id: missionResolvedDevice.id,
                    address: missionResolvedDevice.address,
                    port: missionResolvedDevice.port ?? undefined,
                    sshUser: missionSshUser.trim() || "arduino",
                    password: missionSshPassword || undefined,
                    remotePath,
                    files: filesPayload,
                });

                if (uploadResult?.authRequired) {
                    setMissionAuthRequired(true);
                    setMissionSubmitError("SSH authentication is required to upload mission files.");
                    return;
                }
            }

            const response = await fetch("/api/missions", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    name,
                    deviceId,
                    remotePath,
                    entrypoint,
                    notes: missionNotes.trim(),
                    files: missionFiles.map((file) => ({
                        name: file.name,
                        size: file.size,
                    })),
                }),
            });
            const result = await response.json();

            if (!response.ok) {
                throw new Error(result?.message || "Unable to create the mission.");
            }

            closeMissionDialog();
        } catch (error) {
            setMissionSubmitError(error?.message || "Unable to create the mission.");
        } finally {
            setMissionSubmitting(false);
        }
    }

    function handleDetectedDeviceSelect(device) {
        setSelectedDevice(device);
        setDeviceAlias(device?.name || "");
        setDeviceSshUser(device?.sshUser || (device?.transport === "network" ? "arduino" : ""));
        setDeviceSshPort(String(device?.sshPort || device?.port || 22));
        setOpen(false);
        setIsDeviceDetailsOpen(true);
    }

    async function handleMissionAddDetectedDevice() {
        if (!missionSelectedDetectedDeviceId) {
            return;
        }

        const detectedDevice = missionDetectedDevices.find((device) => device.id === missionSelectedDetectedDeviceId);

        if (!detectedDevice) {
            return;
        }

        try {
            const savedDevice = await persistDetectedDevice(detectedDevice, detectedDevice.name, {
                sshUser: detectedDevice.sshUser || (detectedDevice.transport === "network" ? "arduino" : ""),
                sshPort: detectedDevice.sshPort ?? detectedDevice.port ?? 22,
            });
            setMissionSelectedDeviceId(savedDevice.id);
            setMissionSelectedDetectedDeviceId("");
            setMissionSubmitError("");
        } catch (error) {
            setMissionSubmitError(error?.message || "Unable to add the detected device.");
        }
    }

    function getSavedDeviceStatus(deviceId) {
        return savedDeviceStatuses[deviceId] || "offline";
    }

    function getSavedDeviceAvailabilityStatus(deviceId) {
        if (savedDevicesStatusLoading && !savedDeviceAvailability[deviceId]) {
            return "loading";
        }

        return savedDeviceAvailability[deviceId] || "offline";
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

    function handleSavedDeviceNavigate(device) {
        const deviceStatus = getSavedDeviceStatus(device.id);

        if (deviceStatus === "offline" || deviceStatus === "loading") {
            setUnavailableDevice({
                ...device,
                status: deviceStatus,
            });
            return false;
        }

        void router.push(`/app/device/${device.id}`);
        return true;
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
            const detectedStatuses = createSavedDeviceStatusMap(nextSavedDevices, detectedDevices);
            const connectionStates = await Promise.all(
                (nextSavedDevices || []).map(async (device) => {
                    try {
                        const connectionState = await window.electron?.getDeviceConnectionState?.(device.id);
                        return [device.id, connectionState];
                    } catch (error) {
                        return [device.id, null];
                    }
                })
            );
            const connectionStateMap = Object.fromEntries(connectionStates);
            const nextAvailability = Object.fromEntries(
                (nextSavedDevices || []).map((device) => {
                    const currentStatus = detectedStatuses[device.id] || "offline";
                    const currentConnectionState = connectionStateMap[device.id];

                    if (currentStatus === "online" || isActiveConnectionState(currentConnectionState)) {
                        savedDeviceStatusMisses[device.id] = 0;
                        return [device.id, "online"];
                    }

                    const nextMisses = (savedDeviceStatusMisses[device.id] || 0) + 1;
                    savedDeviceStatusMisses[device.id] = nextMisses;

                    if (nextMisses < DEVICE_STATUS_MISS_THRESHOLD) {
                        return [device.id, savedDeviceAvailabilityCache[device.id] || "online"];
                    }

                    return [device.id, "offline"];
                })
            );
            const nextStatuses = Object.fromEntries(
                (nextSavedDevices || []).map((device) => {
                    const currentConnectionState = connectionStateMap[device.id];
                    const currentDetectedStatus = detectedStatuses[device.id] || "offline";
                    const previousStatus = savedDeviceStatusCache[device.id] || "offline";

                    if (currentConnectionState?.state === "connecting") {
                        return [device.id, "loading"];
                    }

                    if (currentDetectedStatus === "online" && previousStatus === "offline") {
                        return [device.id, "loading"];
                    }

                    if (currentConnectionState?.state === "connected" || currentDetectedStatus === "online") {
                        return [device.id, "online"];
                    }

                    return [device.id, "offline"];
                })
            );

            const activeDeviceIds = new Set((nextSavedDevices || []).map((device) => device.id));
            savedDeviceStatusMisses = Object.fromEntries(
                Object.entries(savedDeviceStatusMisses).filter(([deviceId]) => activeDeviceIds.has(deviceId))
            );

            savedDeviceAvailabilityCache = nextAvailability;
            savedDeviceStatusCache = nextStatuses;
            savedDeviceStatusLastCheckedAt = Date.now();
            setSavedDeviceAvailability(nextAvailability);
            setSavedDeviceStatuses(nextStatuses);
            return nextStatuses;
        })()
            .catch(() => {
                const fallbackStatuses = Object.fromEntries(
                    (nextSavedDevices || []).map((device) => [device.id, "offline"])
                );

                savedDeviceAvailabilityCache = fallbackStatuses;
                savedDeviceStatusCache = fallbackStatuses;
                savedDeviceStatusLastCheckedAt = Date.now();
                setSavedDeviceAvailability(fallbackStatuses);
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
            const savedDevice = await persistDetectedDevice(selectedDevice, deviceAlias.trim() || selectedDevice.name, {
                sshUser: deviceSshUser,
                sshPort: deviceSshPort,
            });
            addSavedDevice(savedDevice);
            setIsDeviceDetailsOpen(false);
            setSelectedDevice(null);
            setDeviceAlias("");
            setDeviceSshUser("arduino");
            setDeviceSshPort("22");
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
            savedDeviceAvailabilityCache = {};
            savedDeviceStatusCache = {};
            savedDeviceStatusLastCheckedAt = 0;
            savedDeviceStatusMisses = {};
            setSavedDeviceAvailability({});
            setSavedDeviceStatuses({});
            setSavedDevicesStatusLoading(false);
            return;
        }

        if (Object.keys(savedDeviceStatusCache).length) {
            setSavedDeviceAvailability(savedDeviceAvailabilityCache);
            setSavedDeviceStatuses(savedDeviceStatusCache);
            setSavedDevicesStatusLoading(false);
        }

        let intervalId;
        let isDisposed = false;

        async function syncStatuses() {
            if (isDisposed) {
                return;
            }

            await refreshSavedDeviceStatuses(statusTrackedSavedDevicesRef.current);
        }

        syncStatuses();
        intervalId = window.setInterval(syncStatuses, DEVICE_STATUS_REFRESH_INTERVAL_MS);

        return () => {
            isDisposed = true;
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
        if (!isMissionDialogOpen) {
            return;
        }

        void loadMissionDetectedDevices();

        if (!missionSelectedDeviceId && ui?.savedDevices?.length) {
            setMissionSelectedDeviceId(ui.savedDevices[0].id);
        }
    }, [isMissionDialogOpen, missionSelectedDeviceId, ui?.savedDevices]);

    useEffect(() => {
        if (!isMissionDialogOpen) {
            return;
        }

        setMissionDirectories([]);
        setMissionRemoteFiles([]);
        setMissionDirectoriesError("");
        setMissionAuthRequired(false);
        setMissionRemotePath(`/home/${missionSshUser.trim() || "arduino"}`);
    }, [isMissionDialogOpen, missionSelectedDeviceId, missionSshUser]);

    useEffect(() => {
        if (!open || !isDevicePalette || !window?.electron?.listDevices) {
            return;
        }

        let cancelled = false;
        let intervalId;

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
                        network: mergeDetectedAndSavedNetworkDevices(result?.groups?.network || [], ui?.savedDevices || []),
                    },
                    network: {
                        neighbors: mergeDetectedAndSavedNetworkDevices(result?.network?.neighbors || [], ui?.savedDevices || []),
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

        void loadDevices();
        intervalId = window.setInterval(() => {
            void loadDevices();
        }, DEVICE_PALETTE_REFRESH_INTERVAL_MS);

        return () => {
            cancelled = true;
            window.clearInterval(intervalId);
        };
    }, [isDevicePalette, open, ui?.savedDevices]);

    if(!session) return null;

    return (
        <div className="h-screen w-full overflow-hidden dark:bg-neutral-800/20 bg-neutrel-50">
            <div
                className="pl-[90px] flex h-11 w-full shrink-0 items-center px-6"
                style={{ WebkitAppRegion: "drag" }}
            >
                <Link href="/app/dashboard" className="absolute font-semibold text-sm w-fit z-50">
                    Placedv Labs
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
                                    className="text-neutral-400 hover:text-black p-1.5 hover:bg-neutral-100 dark:hover:bg-neutral-800 dark:hover:text-white rounded-md cursor-pointer"
                                >
                                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" class="!h-[14px] !w-[14px] lucide lucide-plus-icon lucide-plus"><path d="M5 12h14"/><path d="M12 5v14"/></svg>
                                </div>
                            </div>
                            {ui?.savedDevices?.length ? (
                                <ul className="mt-2 grid gap-1">
                                    {ui.savedDevices.map((device) => (
                                        <li key={device.id} className="group truncate">
                                            <div className={`relative rounded-lg ${router.asPath === `/app/device/${device.id}` || openDeviceMenuId === device.id ? `bg-neutral-100 dark:bg-neutral-800` : `hover:bg-neutral-100 dark:hover:bg-neutral-800`}`}>
                                                <button
                                                    type="button"
                                                    className="flex w-full min-w-0 items-center gap-3 truncate rounded-lg p-1.5 pr-10 text-left text-xs font-semibold"
                                                    onClick={() => handleSavedDeviceNavigate(device)}
                                                    aria-current={router.asPath === `/app/device/${device.id}` ? "page" : undefined}
                                                >
                                                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" className="!max-h-[16px] !min-h-[16px] !h-[16px] shrink-0 lucide lucide-hard-drive-icon lucide-hard-drive"><path d="M10 16h.01"/><path d="M2.212 11.577a2 2 0 0 0-.212.896V18a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-5.527a2 2 0 0 0-.212-.896L18.55 5.11A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/><path d="M21.946 12.013H2.054"/><path d="M6 16h.01"/></svg>
                                                    {getSavedDeviceStatus(device.id) === "loading" ? (
                                                        <svg
                                                            xmlns="http://www.w3.org/2000/svg"
                                                            width="14"
                                                            height="14"
                                                            viewBox="0 0 24 24"
                                                            fill="none"
                                                            stroke="currentColor"
                                                            strokeWidth="2"
                                                            strokeLinecap="round"
                                                            strokeLinejoin="round"
                                                            className="h-3.5 w-3.5 shrink-0 animate-spin text-neutral-500"
                                                            aria-hidden="true"
                                                        >
                                                            <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                                                        </svg>
                                                    ) : (
                                                        <span
                                                            className={`h-2 w-2 shrink-0 rounded-full ${getSavedDeviceStatusClasses(getSavedDeviceStatus(device.id))}`}
                                                            aria-hidden="true"
                                                        />
                                                    )}
                                                    <div className="flex min-w-0 flex-col truncate">
                                                        <span className="truncate">{device.alias || device.name}</span>
                                                    </div>
                                                </button>
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
                        </div>{/*
                        <div className="px-3 pb-3">
                            <div className="flex flex-row items-center justify-between">
                                <h2 className="font-semibold !text-xs text-neutral-400">
                                    Missions
                                </h2>
                                <div
                                    onClick={() => setIsMissionDialogOpen(true)}
                                    className="text-neutral-400 hover:text-black p-1.5 hover:bg-neutral-100 dark:hover:bg-neutral-800 dark:hover:text-white rounded-md cursor-pointer"
                                >
                                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" class="!h-[14px] !w-[14px] lucide lucide-plus-icon lucide-plus"><path d="M5 12h14"/><path d="M12 5v14"/></svg>
                                </div>
                            </div>
                        </div>*/}
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
                                Sign out from Placedv Labs
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
                                    className="h-7 p-0 rounded-lg border-0 border-neutral-200 ring-1 ring-neutral-200 dark:ring-neutral-700 bg-white dark:bg-neutral-800 px-3 text-xs font-semibold outline-none dark:border-neutral-800 focus-visible:ring-blue-500 dark:focus-visible:ring-blue-500"
                                    placeholder="Arduino banco test"
                                />
                            </div>
                            <div className="grid gap-3 md:grid-cols-2">
                                <div className="grid gap-2">
                                    <label htmlFor="device-ssh-user" className="text-neutral-500">SSH user</label>
                                    <Input
                                        id="device-ssh-user"
                                        value={deviceSshUser}
                                        onChange={(event) => setDeviceSshUser(event.target.value)}
                                        className="h-7 p-0 rounded-lg border-0 border-neutral-200 ring-1 ring-neutral-200 dark:ring-neutral-700 bg-white dark:bg-neutral-800 px-3 text-xs font-semibold outline-none dark:border-neutral-800 focus-visible:ring-blue-500 dark:focus-visible:ring-blue-500"
                                        placeholder="arduino"
                                    />
                                </div>
                                <div className="grid gap-2">
                                    <label htmlFor="device-ssh-port" className="text-neutral-500">SSH port</label>
                                    <Input
                                        id="device-ssh-port"
                                        type="number"
                                        min="1"
                                        step="1"
                                        value={deviceSshPort}
                                        onChange={(event) => setDeviceSshPort(event.target.value)}
                                        className="h-7 p-0 rounded-lg border-0 border-neutral-200 ring-1 ring-neutral-200 dark:ring-neutral-700 bg-white dark:bg-neutral-800 px-3 text-xs font-semibold outline-none dark:border-neutral-800 focus-visible:ring-blue-500 dark:focus-visible:ring-blue-500"
                                        placeholder="22"
                                    />
                                </div>
                            </div>
                        </div>
                    ) : null}
                    <DialogFooter>
                        <Button
                            onClick={() => {
                                setIsDeviceDetailsOpen(false);
                                setSelectedDevice(null);
                                setDeviceAlias("");
                                setDeviceSshUser("arduino");
                                setDeviceSshPort("22");
                            }}
                            className="rounded-lg h-7 !font-semibold !text-xs border bg-white hover:bg-neutral-50 text-black dark:text-white dark:bg-neutral-800 dark:border-neutral-700"
                        >
                            Cancel
                        </Button>
                        <Button
                            onClick={handleAddDevice}
                            type="button"
                            className="rounded-lg h-7 !font-semibold !text-xs border border-blue-700 bg-blue-600 hover:bg-blue-700 text-white"
                        >
                            Add device
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
            <Dialog
                open={isMissionDialogOpen}
                onOpenChange={(nextOpen) => {
                    if (nextOpen) {
                        setIsMissionDialogOpen(true);
                        return;
                    }

                    closeMissionDialog();
                }}
            >
                <DialogContent className="top-1/2 sm:max-w-2xl w-[calc(100vw-48px)] h-[min(600px,calc(100vh-64px))] max-h-[calc(100vh-64px)] overflow-hidden p-0 grid gap-0">
                    <DialogHeader className="sticky top-0 z-10 border-b border-neutral-200 bg-white px-3 py-3 dark:border-neutral-800 dark:bg-neutral-900">
                        <DialogTitle className="font-semibold text-sm">New mission</DialogTitle>
                        <DialogDescription className="font-semibold text-xs !mt-0">
                            Create a mission, authenticate over SSH, choose the remote folder, and upload Python files.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="flex-1 overflow-y-auto px-3 py-3">
                        <div className="grid gap-4 text-xs font-semibold">
                            <div className="grid gap-2">
                                <label htmlFor="mission-name" className="text-neutral-500">Mission name</label>
                                <Input
                                    id="mission-name"
                                    value={missionName}
                                    onChange={(event) => setMissionName(event.target.value)}
                                    className="h-7 p-0 rounded-lg border-0 border-neutral-200 ring-1 ring-neutral-200 dark:ring-neutral-700 bg-white dark:bg-neutral-800 px-3 text-xs font-semibold outline-none dark:border-neutral-800 focus-visible:ring-blue-500 dark:focus-visible:ring-blue-500"
                                    placeholder="Payload validation run"
                                />
                            </div>

                            <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
                                <div className="grid gap-2">
                                    <label htmlFor="mission-device" className="text-neutral-500">Saved device</label>
                                    <select
                                        id="mission-device"
                                        value={missionSelectedDeviceId}
                                        onChange={(event) => setMissionSelectedDeviceId(event.target.value)}
                                        className="h-7 rounded-lg border-0 ring-1 ring-neutral-200 dark:ring-neutral-700 bg-white dark:bg-neutral-800 px-3 text-xs font-semibold outline-none dark:border-neutral-800 focus-visible:ring-blue-500 dark:focus-visible:ring-blue-500"
                                    >
                                        <option value="">Select a device</option>
                                        {(ui?.savedDevices || []).map((device) => (
                                            <option key={device.id} value={device.id}>
                                                {device.alias || device.name}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                                <Button
                                    type="button"
                                    onClick={loadMissionDetectedDevices}
                                    disabled={missionDetectedDevicesLoading}
                                    className="rounded-lg h-7 !font-semibold !text-xs border bg-white hover:bg-neutral-50 text-black dark:text-white dark:bg-neutral-800 dark:border-neutral-700"
                                >
                                    Refresh detected
                                </Button>
                            </div>

                            <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
                                <div className="grid gap-2">
                                    <label htmlFor="mission-detected-device" className="text-neutral-500">Add detected device</label>
                                    <select
                                        id="mission-detected-device"
                                        value={missionSelectedDetectedDeviceId}
                                        onChange={(event) => setMissionSelectedDetectedDeviceId(event.target.value)}
                                        className="h-7 rounded-lg border-0 ring-1 ring-neutral-200 dark:ring-neutral-700 bg-white dark:bg-neutral-800 px-3 text-xs font-semibold outline-none dark:border-neutral-800 focus-visible:ring-blue-500 dark:focus-visible:ring-blue-500"
                                    >
                                        <option value="">Select detected device</option>
                                        {missionDetectedDevices.map((device) => (
                                            <option key={device.id} value={device.id}>
                                                {device.name}{device.address ? ` · ${device.address}` : device.path ? ` · ${device.path}` : ""}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                                <Button
                                    type="button"
                                    onClick={handleMissionAddDetectedDevice}
                                    disabled={!missionSelectedDetectedDeviceId}
                                    className="rounded-lg h-7 !font-semibold !text-xs border bg-white hover:bg-neutral-50 text-black dark:text-white dark:bg-neutral-800 dark:border-neutral-700"
                                >
                                    Add device
                                </Button>
                            </div>

                            {missionDetectedDevicesError ? (
                                <p className="text-[11px] font-semibold text-red-500">{missionDetectedDevicesError}</p>
                            ) : null}

                            <div className="grid gap-3 md:grid-cols-2">
                                <div className="grid gap-2">
                                    <label htmlFor="mission-ssh-user" className="text-neutral-500">SSH user</label>
                                    <Input
                                        id="mission-ssh-user"
                                        value={missionSshUser}
                                        onChange={(event) => setMissionSshUser(event.target.value)}
                                        className="h-7 p-0 rounded-lg border-0 border-neutral-200 ring-1 ring-neutral-200 dark:ring-neutral-700 bg-white dark:bg-neutral-800 px-3 text-xs font-semibold outline-none dark:border-neutral-800 focus-visible:ring-blue-500 dark:focus-visible:ring-blue-500"
                                        placeholder="arduino"
                                    />
                                </div>
                                <div className="grid gap-2">
                                    <label htmlFor="mission-ssh-password" className="text-neutral-500">SSH password</label>
                                    <Input
                                        id="mission-ssh-password"
                                        type="password"
                                        value={missionSshPassword}
                                        onChange={(event) => setMissionSshPassword(event.target.value)}
                                        className="h-7 p-0 rounded-lg border-0 border-neutral-200 ring-1 ring-neutral-200 dark:ring-neutral-700 bg-white dark:bg-neutral-800 px-3 text-xs font-semibold outline-none dark:border-neutral-800 focus-visible:ring-blue-500 dark:focus-visible:ring-blue-500"
                                        placeholder="Optional until requested"
                                    />
                                </div>
                            </div>

                            <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
                                <div className="grid gap-2">
                                    <label htmlFor="mission-remote-path" className="text-neutral-500">Remote folder</label>
                                    <Input
                                        id="mission-remote-path"
                                        value={missionRemotePath}
                                        onChange={(event) => setMissionRemotePath(event.target.value)}
                                        className="h-7 p-0 rounded-lg border-0 border-neutral-200 ring-1 ring-neutral-200 dark:ring-neutral-700 bg-white dark:bg-neutral-800 px-3 text-xs font-semibold outline-none dark:border-neutral-800 focus-visible:ring-blue-500 dark:focus-visible:ring-blue-500"
                                        placeholder="/home/arduino/missions/run-01"
                                    />
                                </div>
                                <Button
                                    type="button"
                                    onClick={() => handleMissionBrowseDirectories()}
                                    disabled={missionDirectoriesLoading || !missionSelectedDeviceId}
                                    className="rounded-lg h-7 !font-semibold !text-xs border bg-white hover:bg-neutral-50 text-black dark:text-white dark:bg-neutral-800 dark:border-neutral-700"
                                >
                                    {missionDirectoriesLoading ? "Loading..." : "Load folders"}
                                </Button>
                            </div>

                            {missionAuthRequired ? (
                                <p className="text-[11px] font-semibold text-amber-500">
                                    SSH authentication required. Enter the password and load the folders again.
                                </p>
                            ) : null}

                            {missionDirectoriesError ? (
                                <p className="text-[11px] font-semibold text-red-500">{missionDirectoriesError}</p>
                            ) : null}

                            <div className="grid gap-2">
                                <div className="flex items-center justify-between">
                                    <span className="text-neutral-500">Remote directories</span>
                                    {missionRemotePath && missionRemotePath !== "/" ? (
                                        <button
                                            type="button"
                                            onClick={() => {
                                                const parentPath = missionRemotePath.split("/").slice(0, -1).join("/") || "/";
                                                void handleMissionBrowseDirectories(parentPath);
                                            }}
                                            className="text-[11px] font-semibold text-blue-500"
                                        >
                                            Go up
                                        </button>
                                    ) : null}
                                </div>
                                <div className="max-h-32 overflow-y-auto rounded-xl border border-neutral-200 bg-white p-2 dark:border-neutral-800 dark:bg-neutral-900">
                                    {missionDirectories.length ? (
                                        <div className="grid gap-1">
                                            {missionDirectories.map((directory) => (
                                                <button
                                                    key={directory.path}
                                                    type="button"
                                                    onClick={() => setMissionRemotePath(directory.path)}
                                                    className={`rounded-lg px-2 py-1 text-left text-xs font-semibold ${missionRemotePath === directory.path ? `bg-blue-50 text-blue-600 dark:bg-neutral-800 dark:text-white` : `hover:bg-neutral-100 dark:hover:bg-neutral-800`}`}
                                                >
                                                    {directory.name}
                                                </button>
                                            ))}
                                        </div>
                                    ) : (
                                        <p className="text-[11px] font-semibold text-neutral-400">
                                            {missionDirectoriesLoading ? "Reading remote folders..." : "No directories loaded yet."}
                                        </p>
                                    )}
                                </div>
                            </div>

                            <div className="grid gap-2">
                                <span className="text-neutral-500">Python files in selected folder</span>
                                <div className="max-h-24 overflow-y-auto rounded-xl border border-neutral-200 bg-white p-2 dark:border-neutral-800 dark:bg-neutral-900">
                                    {missionRemoteFiles.length ? (
                                        <div className="flex flex-wrap gap-1">
                                            {missionRemoteFiles.map((file) => (
                                                <Badge key={file.path} variant="secondary" className="font-semibold text-[10px]">
                                                    {file.name}
                                                </Badge>
                                            ))}
                                        </div>
                                    ) : (
                                        <p className="text-[11px] font-semibold text-neutral-400">
                                            No Python files found in the selected folder.
                                        </p>
                                    )}
                                </div>
                            </div>

                            <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
                                <div className="grid gap-2">
                                    <label htmlFor="mission-new-directory" className="text-neutral-500">Create remote folder</label>
                                    <Input
                                        id="mission-new-directory"
                                        value={missionNewDirectoryName}
                                        onChange={(event) => setMissionNewDirectoryName(event.target.value)}
                                        className="h-7 p-0 rounded-lg border-0 border-neutral-200 ring-1 ring-neutral-200 dark:ring-neutral-700 bg-white dark:bg-neutral-800 px-3 text-xs font-semibold outline-none dark:border-neutral-800 focus-visible:ring-blue-500 dark:focus-visible:ring-blue-500"
                                        placeholder="mission-001"
                                    />
                                </div>
                                <Button
                                    type="button"
                                    onClick={handleMissionCreateDirectory}
                                    disabled={!missionNewDirectoryName.trim() || missionDirectoriesLoading || !missionRemotePath}
                                    className="rounded-lg h-7 !font-semibold !text-xs border bg-white hover:bg-neutral-50 text-black dark:text-white dark:bg-neutral-800 dark:border-neutral-700"
                                >
                                    Create folder
                                </Button>
                            </div>

                            <div className="grid gap-2">
                                <label htmlFor="mission-files" className="text-neutral-500">Mission files (.py)</label>
                                <input
                                    id="mission-files"
                                    type="file"
                                    accept=".py"
                                    multiple
                                    onChange={handleMissionFilesChange}
                                    className="block w-full rounded-lg border-0 ring-1 ring-neutral-200 dark:ring-neutral-700 bg-white dark:bg-neutral-800 px-3 py-2 text-xs font-semibold outline-none focus-visible:ring-blue-500 dark:focus-visible:ring-blue-500"
                                />
                                {missionFiles.length ? (
                                    <div className="flex flex-wrap gap-1">
                                        {missionFiles.map((file) => (
                                            <Badge key={file.name} variant="secondary" className="font-semibold text-[10px]">
                                                {file.name}
                                            </Badge>
                                        ))}
                                    </div>
                                ) : null}
                            </div>

                            <div className="grid gap-2">
                                <label htmlFor="mission-entrypoint" className="text-neutral-500">Entrypoint</label>
                                <select
                                    id="mission-entrypoint"
                                    value={missionEntrypoint}
                                    onChange={(event) => setMissionEntrypoint(event.target.value)}
                                    className="h-7 rounded-lg border-0 ring-1 ring-neutral-200 dark:ring-neutral-700 bg-white dark:bg-neutral-800 px-3 text-xs font-semibold outline-none dark:border-neutral-800 focus-visible:ring-blue-500 dark:focus-visible:ring-blue-500"
                                >
                                    <option value="">Select entrypoint</option>
                                    {missionEntrypointOptions.map((fileName) => (
                                        <option key={fileName} value={fileName}>
                                            {fileName}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            <div className="grid gap-2">
                                <label htmlFor="mission-notes" className="text-neutral-500">Notes</label>
                                <textarea
                                    id="mission-notes"
                                    value={missionNotes}
                                    onChange={(event) => setMissionNotes(event.target.value)}
                                    rows={3}
                                    className="rounded-lg border-0 ring-1 ring-neutral-200 dark:ring-neutral-700 bg-white dark:bg-neutral-800 px-3 py-2 text-xs font-semibold outline-none dark:border-neutral-800 focus-visible:ring-blue-500 dark:focus-visible:ring-blue-500"
                                    placeholder="Optional mission notes"
                                />
                            </div>

                            {missionSubmitError ? (
                                <p className="text-[11px] font-semibold text-red-500">{missionSubmitError}</p>
                            ) : null}
                        </div>
                    </div>
                    <DialogFooter className="sticky bottom-0 z-10 border-t border-neutral-200 bg-white px-3 py-3 dark:border-neutral-800 dark:bg-neutral-900">
                        <Button
                            onClick={closeMissionDialog}
                            className="rounded-lg h-7 !font-semibold !text-xs border bg-white hover:bg-neutral-50 text-black dark:text-white dark:bg-neutral-800 dark:border-neutral-700"
                        >
                            Cancel
                        </Button>
                        <Button
                            onClick={handleCreateMission}
                            type="button"
                            disabled={missionSubmitting || !missionName.trim() || !missionSelectedDeviceId || !missionRemotePath.trim() || !missionEntrypoint.trim()}
                            className="rounded-lg h-7 !font-semibold !text-xs border bg-blue-600 hover:bg-blue-700 border-blue-800 text-white dark:text-white dark:bg-neutral-800 dark:border-neutral-700"
                        >
                            {missionSubmitting ? "Creating..." : "Create mission"}
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
