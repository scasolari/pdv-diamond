import Layout from "@/components/layout";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { setDeviceTerminalOpen } from "@/redux/actions/main";
import { connect } from "react-redux";
import { useRouter } from "next/router";
import { useEffect, useMemo, useRef, useState } from "react";

function isAuthErrorMessage(message) {
    return String(message || "").toLowerCase().includes("authentication methods failed");
}

function isActiveConnectionState(connectionState) {
    return connectionState?.state === "connected" || connectionState?.state === "connecting";
}

function normalizeDeviceText(value) {
    return String(value || "")
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "");
}

function isArduinoLikeDevice(device) {
    const searchable = [
        device?.alias,
        device?.name,
        device?.manufacturer,
        device?.path,
    ]
        .map(normalizeDeviceText)
        .join(" ");

    return searchable.includes("arduino");
}

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

function buildDeviceMatchKeys(device) {
    if (!device) {
        return [];
    }

    return [
        device.sourceKey,
        device.id,
        device.path,
        device.address,
        device.serialNumber,
        device.pnpId,
        device.mac,
        device.interface,
        device.protocol && device.address ? `${device.protocol}:${device.address}` : "",
        device.vendorId && device.productId ? `${device.vendorId}:${device.productId}` : "",
    ].filter(Boolean);
}

function findDetectedDeviceMatch(savedDevice, detectedDevices) {
    if (!savedDevice || !Array.isArray(detectedDevices) || !detectedDevices.length) {
        return null;
    }

    const savedKeys = new Set(buildDeviceMatchKeys(savedDevice));

    return (
        detectedDevices.find((detectedDevice) => {
            const detectedKeys = buildDeviceMatchKeys(detectedDevice);
            return detectedKeys.some((key) => savedKeys.has(key));
        }) || null
    );
}

function getResolvedDetectedDevice(savedDevice, detectedDevices) {
    return findDetectedDeviceMatch(savedDevice, detectedDevices);
}

function isSavedDeviceAvailable(savedDevice, detectedDevices) {
    if (!savedDevice || !Array.isArray(detectedDevices) || !detectedDevices.length) {
        return false;
    }

    const detectedKeys = new Set();

    detectedDevices.forEach((device) => {
        [
            device.id,
            device.path,
            device.address,
            device.serialNumber,
            device.pnpId,
            device.mac,
            device.interface,
            device.protocol && device.address ? `${device.protocol}:${device.address}` : "",
            device.vendorId && device.productId ? `${device.vendorId}:${device.productId}` : "",
            buildSavedDeviceSourceKey(device),
        ]
            .filter(Boolean)
            .forEach((key) => detectedKeys.add(key));
    });

    return [
        savedDevice.sourceKey,
        savedDevice.path,
        savedDevice.address,
        savedDevice.serialNumber,
        savedDevice.pnpId,
        savedDevice.mac,
        savedDevice.interface,
        savedDevice.protocol && savedDevice.address ? `${savedDevice.protocol}:${savedDevice.address}` : "",
        savedDevice.vendorId && savedDevice.productId ? `${savedDevice.vendorId}:${savedDevice.productId}` : "",
        buildSavedDeviceSourceKey(savedDevice),
    ]
        .filter(Boolean)
        .some((key) => detectedKeys.has(key));
}

function getDetectedDevicesList(detectedResult) {
    return [
        ...(detectedResult?.groups?.usb || []),
        ...(detectedResult?.groups?.network || []),
        ...(detectedResult?.connected || []),
    ];
}

function LoadingTitle() {
    return (
        <div>
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
                className="h-[14px] w-[14px] animate-spin text-neutral-500"
            >
                <path d="M21 12a9 9 0 1 1-6.219-8.56" />
            </svg>
        </div>
    );
}

function DevicePage({ setDeviceTerminalOpen }) {
    const router = useRouter();
    const { id } = router.query;
    const [device, setDevice] = useState(null);
    const [isLoading, setIsLoading] = useState(true);
    const [loadError, setLoadError] = useState("");
    const [terminalError, setTerminalError] = useState("");
    const [availabilityMessage, setAvailabilityMessage] = useState("");
    const [unavailableDevice, setUnavailableDevice] = useState(null);
    const terminalContainerRef = useRef(null);
    const deviceRef = useRef(null);
    const deviceConnectionStateRef = useRef(null);
    const deviceAvailabilityMissesRef = useRef(0);
    const hasRedirectedUnavailableRef = useRef(false);

    useEffect(() => {
        deviceRef.current = device;
    }, [device]);

    useEffect(() => {
        deviceAvailabilityMissesRef.current = 0;
        hasRedirectedUnavailableRef.current = false;
        setUnavailableDevice(null);
    }, [device?.id]);

    const terminalMode = useMemo(() => {
        if (
            (device?.transport === "network" || device?.type === "network") &&
            device?.address
        ) {
            return "ssh";
        }

        if (device?.path) {
            return "serial";
        }

        return null;
    }, [device?.address, device?.path, device?.protocol, device?.transport, device?.type]);

    const terminalAvailabilityMessage = useMemo(() => {
        if (terminalMode === "ssh") {
            return "Unable to open the SSH terminal for this device.";
        }

        if (terminalMode === "serial") {
            return "Serial console is not available for this device.";
        }

        return "No supported terminal is available for this device.";
    }, [device?.address, device?.transport, device?.type, terminalMode]);

    useEffect(() => {
        if (!router.isReady || !id) {
            return;
        }

        let cancelled = false;

        async function loadDevice() {
            setIsLoading(true);
            setLoadError("");
            setTerminalError("");
            setAvailabilityMessage("");

            try {
                const response = await fetch(`/api/devices/${id}`);
                const payload = await response.json();

                if (!response.ok) {
                    throw new Error(payload?.message || "Unable to load device.");
                }

                if (cancelled) {
                    return;
                }

                let nextDevice = payload;

                if (window?.electron?.listDevices) {
                    try {
                        const detectedResult = await window.electron.listDevices();
                        const detectedDevices = getDetectedDevicesList(detectedResult);
                        const resolvedDevice = getResolvedDetectedDevice(payload, detectedDevices);

                        if (resolvedDevice) {
                            nextDevice = {
                                ...payload,
                                address: resolvedDevice.address ?? payload.address ?? null,
                                port: resolvedDevice.port ?? payload.port ?? null,
                                sshPort: resolvedDevice.sshPort ?? payload.sshPort ?? payload.port ?? null,
                                protocol: resolvedDevice.protocol ?? payload.protocol ?? null,
                                path: resolvedDevice.path ?? payload.path ?? null,
                            };
                        }
                    } catch (error) {
                        nextDevice = payload;
                    }
                }

                setDevice(nextDevice);
            } catch (error) {
                if (!cancelled) {
                    setLoadError(error?.message || "Unable to load device.");
                    setDevice(null);
                }
            } finally {
                if (!cancelled) {
                    setIsLoading(false);
                }
            }
        }

        loadDevice();

        return () => {
            cancelled = true;
        };
    }, [id, router.isReady]);

    useEffect(() => {
        if (!device?.id || !window?.electron?.onDeviceConnectionStatus) {
            deviceConnectionStateRef.current = null;
            return;
        }

        deviceConnectionStateRef.current = null;

        const unsubscribe = window.electron.onDeviceConnectionStatus((payload) => {
            if (payload?.deviceId !== device.id) {
                return;
            }

            deviceConnectionStateRef.current = payload;
        });

        window.electron
            ?.getDeviceConnectionState?.(device.id)
            .then((payload) => {
                deviceConnectionStateRef.current = payload;
            })
            .catch(() => {});

        return () => {
            unsubscribe?.();
        };
    }, [device?.id]);

    useEffect(() => {
        if (!device?.id || !window?.electron?.listDevices) {
            return;
        }

        let cancelled = false;
        const deviceId = device.id;

        const checkDeviceAvailability = async () => {
            try {
                const detectedResult = await window.electron.listDevices();

                if (cancelled) {
                    return;
                }

                const currentDevice = deviceRef.current;
                if (!currentDevice || currentDevice.id !== deviceId) {
                    return;
                }

                const detectedDevices = getDetectedDevicesList(detectedResult);
                const resolvedDevice = getResolvedDetectedDevice(currentDevice, detectedDevices);
                let isAvailable = isSavedDeviceAvailable(currentDevice, detectedDevices) || Boolean(resolvedDevice);

                if (isAvailable && resolvedDevice) {
                    setDevice((latestDevice) => {
                        if (!latestDevice || latestDevice.id !== deviceId) {
                            return latestDevice;
                        }

                        const nextAddress = resolvedDevice.address ?? latestDevice.address ?? null;
                        const nextPort = resolvedDevice.port ?? latestDevice.port ?? null;
                        const nextSshPort = resolvedDevice.sshPort ?? latestDevice.sshPort ?? latestDevice.port ?? null;
                        const nextProtocol = resolvedDevice.protocol ?? latestDevice.protocol ?? null;
                        const nextPath = resolvedDevice.path ?? latestDevice.path ?? null;

                        if (
                            nextAddress === (latestDevice.address ?? null) &&
                            nextPort === (latestDevice.port ?? null) &&
                            nextSshPort === (latestDevice.sshPort ?? latestDevice.port ?? null) &&
                            nextProtocol === (latestDevice.protocol ?? null) &&
                            nextPath === (latestDevice.path ?? null)
                        ) {
                            return latestDevice;
                        }

                        return {
                            ...latestDevice,
                            address: nextAddress,
                            port: nextPort,
                            sshPort: nextSshPort,
                            protocol: nextProtocol,
                            path: nextPath,
                        };
                    });
                }

                if (isAvailable) {
                    deviceAvailabilityMissesRef.current = 0;
                    return;
                }

                await new Promise((resolve) => {
                    window.setTimeout(resolve, 1000);
                });

                if (cancelled) {
                    return;
                }

                const retryResult = await window.electron.listDevices();

                if (cancelled) {
                    return;
                }

                const retryDetectedDevices = getDetectedDevicesList(retryResult);
                const retryResolvedDevice = getResolvedDetectedDevice(currentDevice, retryDetectedDevices);
                isAvailable =
                    isSavedDeviceAvailable(currentDevice, retryDetectedDevices) ||
                    Boolean(retryResolvedDevice);

                if (isAvailable) {
                    if (retryResolvedDevice) {
                        setDevice((latestDevice) => {
                            if (!latestDevice || latestDevice.id !== deviceId) {
                                return latestDevice;
                            }

                            const nextAddress = retryResolvedDevice.address ?? latestDevice.address ?? null;
                            const nextPort = retryResolvedDevice.port ?? latestDevice.port ?? null;
                            const nextSshPort = retryResolvedDevice.sshPort ?? latestDevice.sshPort ?? latestDevice.port ?? null;
                            const nextProtocol = retryResolvedDevice.protocol ?? latestDevice.protocol ?? null;
                            const nextPath = retryResolvedDevice.path ?? latestDevice.path ?? null;

                            if (
                                nextAddress === (latestDevice.address ?? null) &&
                                nextPort === (latestDevice.port ?? null) &&
                                nextSshPort === (latestDevice.sshPort ?? latestDevice.port ?? null) &&
                                nextProtocol === (latestDevice.protocol ?? null) &&
                                nextPath === (latestDevice.path ?? null)
                            ) {
                                return latestDevice;
                            }

                            return {
                                ...latestDevice,
                                address: nextAddress,
                                port: nextPort,
                                sshPort: nextSshPort,
                                protocol: nextProtocol,
                                path: nextPath,
                            };
                        });
                    }

                    deviceAvailabilityMissesRef.current = 0;
                    return;
                }

                const currentConnectionState =
                    deviceConnectionStateRef.current?.deviceId === deviceId
                        ? deviceConnectionStateRef.current
                        : await window.electron?.getDeviceConnectionState?.(deviceId).catch(() => null);

                if (isActiveConnectionState(currentConnectionState)) {
                    deviceAvailabilityMissesRef.current = 0;
                    return;
                }

                deviceAvailabilityMissesRef.current += 1;

                if (deviceAvailabilityMissesRef.current < 3 || hasRedirectedUnavailableRef.current) {
                    return;
                }

                hasRedirectedUnavailableRef.current = true;

                window.electron?.closeDeviceTerminal?.(deviceId).catch(() => {});
                setDeviceTerminalOpen(deviceId, false);

                const offlineDevice = {
                    ...currentDevice,
                    status: "offline",
                };

                setUnavailableDevice(offlineDevice);

                if (typeof window !== "undefined") {
                    window.localStorage.setItem(
                        "pending_unavailable_device",
                        JSON.stringify(offlineDevice)
                    );
                }

                await router.push("/app/dashboard");
            } catch (error) {
                return;
            }
        };

        checkDeviceAvailability();
        const intervalId = window.setInterval(checkDeviceAvailability, 30000);

        return () => {
            cancelled = true;
            window.clearInterval(intervalId);
        };
    }, [device?.id, router, setDeviceTerminalOpen]);

    useEffect(() => {
        if (!device?.id || !terminalContainerRef.current || isLoading || loadError) {
            return;
        }

        const terminalElement = terminalContainerRef.current;
        let terminal = null;
        let fitAddon = null;
        let resizeObserver = null;
        let handleResize = null;
        let terminalInputSubscription = null;
        let passwordInputSubscription = null;
        let removeTerminalDataListener = null;
        let removeTerminalExitListener = null;
        let disposed = false;
        let isRemoteConnected = false;
        let isConnecting = false;
        let passwordBuffer = "";
        let resizeFrameId = null;
        let initialFitFrameId = null;
        const nextTerminalMode = terminalMode;
        const sshAddress = device?.address;
        const sshPort = Number(device?.sshPort ?? device?.port) || 22;
        const sshUser = String(device?.sshUser || "").trim() || "arduino";
        const serialPath = device?.path;
        const serialBaudRate = Number(device?.baudRate) || 115200;

        function safeFit() {
            if (
                disposed ||
                !fitAddon ||
                !terminal ||
                !terminal.element ||
                !terminal.textarea ||
                !terminal.element.isConnected ||
                !terminalElement?.isConnected ||
                terminalElement.clientWidth <= 0 ||
                terminalElement.clientHeight <= 0
            ) {
                return false;
            }

            try {
                fitAddon.fit();
                return true;
            } catch (error) {
                return false;
            }
        }

        function cancelScheduledResize() {
            if (resizeFrameId) {
                window.cancelAnimationFrame(resizeFrameId);
                resizeFrameId = null;
            }
        }

        function cancelInitialFit() {
            if (initialFitFrameId) {
                window.cancelAnimationFrame(initialFitFrameId);
                initialFitFrameId = null;
            }
        }

        function disposeRemoteInput() {
            terminalInputSubscription?.dispose?.();
            terminalInputSubscription = null;
        }

        function disposePasswordInput() {
            passwordInputSubscription?.dispose?.();
            passwordInputSubscription = null;
        }

        function attachRemoteInput() {
            disposeRemoteInput();

            terminalInputSubscription = terminal.onData((data) => {
                window.electron.writeDeviceTerminal(device.id, data).catch(() => {});
            });
        }

        function promptForPassword() {
            if (!terminal || disposed || nextTerminalMode !== "ssh") {
                return;
            }

            disposeRemoteInput();
            disposePasswordInput();
            isConnecting = false;
            passwordBuffer = "";
            setTerminalError("");
            terminal.writeln("");
            terminal.write(`Password for ${sshUser}@${sshAddress}: `);

            passwordInputSubscription = terminal.onData((data) => {
                if (data === "\r") {
                    const password = passwordBuffer;

                    disposePasswordInput();
                    terminal.writeln("");
                    openSshSession(password).catch(() => {});
                    return;
                }

                if (data === "\u0003") {
                    disposePasswordInput();
                    terminal.writeln("^C");
                    terminal.writeln("Authentication cancelled.");
                    return;
                }

                if (data === "\u007F") {
                    if (passwordBuffer.length > 0) {
                        passwordBuffer = passwordBuffer.slice(0, -1);
                    }
                    return;
                }

                if (data >= " " && data !== "\u001b") {
                    passwordBuffer += data;
                }
            });
        }

        async function openSshSession(password) {
            if (!terminal || disposed || isConnecting) {
                return;
            }

            isConnecting = true;

            try {
                setTerminalError("");
                setAvailabilityMessage("");

                const session = await window.electron.openDeviceTerminal({
                    id: device.id,
                    address: sshAddress,
                    port: sshPort,
                    sshUser,
                    password,
                    cols: terminal.cols,
                    rows: terminal.rows,
                });

                if (session?.authRequired) {
                    isConnecting = false;
                    isRemoteConnected = false;
                    promptForPassword();
                    return;
                }

                if (session?.error) {
                    isConnecting = false;
                    isRemoteConnected = false;
                    setDeviceTerminalOpen(device.id, false);
                    setTerminalError("");
                    setAvailabilityMessage(session?.message || terminalAvailabilityMessage);
                    return;
                }

                isRemoteConnected = true;
                isConnecting = false;
                setDeviceTerminalOpen(device.id, true);

                if (!session?.reused) {
                    terminal.writeln("");
                }

                attachRemoteInput();
            } catch (error) {
                isConnecting = false;
                isRemoteConnected = false;

                const nextMessage =
                    error?.message || "Unable to open the SSH terminal.";

                if (isAuthErrorMessage(nextMessage) && !password) {
                    promptForPassword();
                    return;
                }

                setTerminalError(nextMessage);
            }
        }

        async function openSerialSession() {
            if (!terminal || disposed || isConnecting) {
                return;
            }

            isConnecting = true;

            try {
                setTerminalError("");
                setAvailabilityMessage("");

                const session = await window.electron.openDeviceTerminal({
                    id: device.id,
                    path: serialPath,
                    baudRate: serialBaudRate,
                    transport: device?.transport,
                    type: device?.type,
                    cols: terminal.cols,
                    rows: terminal.rows,
                });

                if (session?.error) {
                    isConnecting = false;
                    isRemoteConnected = false;
                    setDeviceTerminalOpen(device.id, false);
                    setTerminalError("");
                    setAvailabilityMessage(session?.message || terminalAvailabilityMessage);
                    return;
                }

                isRemoteConnected = true;
                isConnecting = false;
                setDeviceTerminalOpen(device.id, true);

                if (!session?.reused) {
                    terminal.writeln("");
                    terminal.writeln(
                        `[serial] connected to ${serialPath} at ${serialBaudRate} baud`
                    );
                    terminal.writeln("[serial] waiting for device output...");
                }

                attachRemoteInput();
            } catch (error) {
                isConnecting = false;
                isRemoteConnected = false;
                setTerminalError(error?.message || "Unable to open the serial console.");
            }
        }

        async function mountTerminal() {
            const [{ Terminal }, { FitAddon }] = await Promise.all([
                import("xterm"),
                import("xterm-addon-fit"),
            ]);

            if (disposed || !terminalElement) {
                return;
            }

            terminal = new Terminal({
                cursorBlink: true,
                convertEol: true,
                fontSize: 12,
                fontFamily: "monospace",
                theme: {
                    background: "#000000",
                },
            });

            fitAddon = new FitAddon();
            terminal.loadAddon(fitAddon);
            terminal.open(terminalElement);
            safeFit();
            initialFitFrameId = window.requestAnimationFrame(() => {
                initialFitFrameId = null;
                safeFit();
            });

            if (!nextTerminalMode) {
                setDeviceTerminalOpen(device.id, false);
                setAvailabilityMessage(terminalAvailabilityMessage);
                return;
            }

            removeTerminalDataListener = window.electron?.onDeviceTerminalData?.((payload) => {
                if (payload?.deviceId !== device.id || !terminal) {
                    return;
                }

                terminal.write(String(payload.data || ""));
            });

            removeTerminalExitListener = window.electron?.onDeviceTerminalExit?.((payload) => {
                if (payload?.deviceId !== device.id || !terminal) {
                    return;
                }

                terminal.writeln("");
                terminal.writeln(
                    nextTerminalMode === "ssh"
                        ? "[ssh] session closed"
                        : "[serial] session closed"
                );
            });

            setTerminalError("");
            setAvailabilityMessage("");

            if (nextTerminalMode === "ssh") {
                terminal.writeln(`$ ssh ${sshUser}@${sshAddress}`);
                await openSshSession();
            } else {
                terminal.writeln(`$ serial ${serialPath}`);
                await openSerialSession();
            }

            handleResize = () => {
                cancelScheduledResize();

                resizeFrameId = window.requestAnimationFrame(() => {
                    resizeFrameId = null;

                    if (disposed || !fitAddon || !terminal || !terminal.element?.isConnected) {
                        return;
                    }

                    if (!safeFit() || !isRemoteConnected) {
                        return;
                    }

                    window.electron
                        .resizeDeviceTerminal(device.id, {
                            cols: terminal.cols,
                            rows: terminal.rows,
                        })
                        .catch(() => {});
                });
            };

            const observeTarget = terminalElement.parentElement || terminalElement;

            window.addEventListener("resize", handleResize);
            resizeObserver = new ResizeObserver(() => {
                if (!fitAddon || !terminal) {
                    return;
                }

                handleResize();
            });
            resizeObserver.observe(observeTarget);
        }

        mountTerminal().catch((error) => {
            setTerminalError(
                error?.message ||
                    (nextTerminalMode === "ssh"
                        ? "Unable to open the SSH terminal."
                        : "Unable to open the serial console.")
            );
        });

        return () => {
            disposed = true;

            removeTerminalDataListener?.();
            removeTerminalExitListener?.();
            disposeRemoteInput();
            disposePasswordInput();
            resizeObserver?.disconnect();
            cancelScheduledResize();
            cancelInitialFit();

            if (handleResize) {
                window.removeEventListener("resize", handleResize);
            }

            if (terminal) {
                terminal.dispose();
                terminal = null;
                fitAddon = null;
            }

            terminalElement.innerHTML = "";
        };
    }, [
        device?.address,
        device?.baudRate,
        device?.id,
        device?.path,
        device?.port,
        device?.transport,
        device?.type,
        isLoading,
        loadError,
        setDeviceTerminalOpen,
        terminalAvailabilityMessage,
        terminalMode,
    ]);

    return (
        <Layout title={device?.alias || device?.name || <LoadingTitle />}>
            <div className="h-full overflow-hidden">
                <div className="relative h-full w-full overflow-hidden border-t bg-black">
                    {loadError ? (
                        <div className="flex h-full items-center justify-center p-6 text-center text-sm font-medium text-red-300">
                            {loadError}
                        </div>
                    ) : null}
                    {!loadError && terminalError ? (
                        <div className="absolute left-3 right-3 top-3 z-10 rounded-md border border-red-900 bg-red-950/40 px-3 py-2 text-xs font-semibold text-red-300">
                            {terminalError}
                        </div>
                    ) : null}
                    {!loadError && availabilityMessage ? (
                        <div className="absolute left-3 right-3 top-3 z-10 rounded-md border border-amber-900 bg-amber-950/40 px-3 py-2 text-xs font-semibold text-amber-300">
                            {availabilityMessage}
                        </div>
                    ) : null}
                    {!loadError && terminalMode ? (
                        <div
                            ref={terminalContainerRef}
                            className="h-full w-full overflow-hidden bg-black p-2"
                        />
                    ) : null}
                    {!loadError && !terminalMode ? (
                        <div className="flex h-full items-center justify-center px-6 text-center text-sm font-medium text-neutral-500">
                            {availabilityMessage || terminalAvailabilityMessage}
                        </div>
                    ) : null}
                </div>
            </div>
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
                        <DialogTitle className="text-sm font-semibold">
                            Device offline
                        </DialogTitle>
                        <DialogDescription className="text-xs font-semibold">
                            {(unavailableDevice?.alias || unavailableDevice?.name || "This device")} is no
                            longer available. Check the device connection and try again.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button
                            onClick={() => setUnavailableDevice(null)}
                            className="h-7 rounded-lg border bg-white text-xs font-semibold text-black hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-800 dark:text-white"
                        >
                            OK
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </Layout>
    );
}

const mapDispatchToProps = {
    setDeviceTerminalOpen,
};

export default connect(null, mapDispatchToProps)(DevicePage);
