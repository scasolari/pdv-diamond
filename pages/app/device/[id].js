import Layout from "@/components/layout";
import {
    ResizableHandle,
    ResizablePanel,
    ResizablePanelGroup,
} from "@/components/ui/resizable";
import { setDeviceTerminalOpen, setTerminalHeight } from "@/redux/actions/main";
import { connect } from "react-redux";
import { useRouter } from "next/router";
import { useEffect, useMemo, useRef, useState } from "react";

function isAuthErrorMessage(message) {
    return String(message || "").toLowerCase().includes("authentication methods failed");
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
        device.vendorId && device.productId ? `${device.vendorId}:${device.productId}` : "",
    ].filter(Boolean);
}

function findDetectedDeviceMatch(savedDevice, detectedDevices) {
    if (!savedDevice || !Array.isArray(detectedDevices) || !detectedDevices.length) {
        return null;
    }

    const savedKeys = new Set(buildDeviceMatchKeys(savedDevice));

    return detectedDevices.find((detectedDevice) => {
        const detectedKeys = buildDeviceMatchKeys(detectedDevice);
        return detectedKeys.some((key) => savedKeys.has(key));
    }) || null;
}

function findPreferredNetworkSibling(savedDevice, detectedDevices) {
    if (!savedDevice?.path || !isArduinoLikeDevice(savedDevice)) {
        return null;
    }

    const networkCandidates = (detectedDevices || []).filter((detectedDevice) => {
        return Boolean(
            detectedDevice?.address &&
            (detectedDevice?.type === "network" ||
                detectedDevice?.transport === "network" ||
                detectedDevice?.protocol === "ssh")
        );
    });

    if (networkCandidates.length === 1) {
        return networkCandidates[0];
    }

    return null;
}

function DevicePage({
    terminalHeight,
    deviceTerminalOpenById,
    setTerminalHeight,
    setDeviceTerminalOpen,
}) {
    const router = useRouter();
    const { id } = router.query;
    const [device, setDevice] = useState(null);
    const [isLoading, setIsLoading] = useState(true);
    const [loadError, setLoadError] = useState("");
    const [isTerminalOpen, setIsTerminalOpen] = useState(false);
    const [terminalError, setTerminalError] = useState("");
    const [availabilityMessage, setAvailabilityMessage] = useState("");
    const pageContainerRef = useRef(null);
    const panelGroupRef = useRef(null);
    const terminalContainerRef = useRef(null);
    const hasLoadedTerminalHeight = useRef(false);
    const [groupHeight, setGroupHeight] = useState(0);

    useEffect(() => {
        const updateHeight = () => {
            setGroupHeight(pageContainerRef.current?.clientHeight ?? 0);
        };

        updateHeight();
        window.addEventListener("resize", updateHeight);

        return () => {
            window.removeEventListener("resize", updateHeight);
        };
    }, []);

    const minTerminalSize = useMemo(() => {
        if (!groupHeight) {
            return 20;
        }

        return Math.min((180 / groupHeight) * 100, 60);
    }, [groupHeight]);

    const maxTerminalSize = useMemo(() => {
        if (!groupHeight) {
            return 60;
        }

        return Math.min((600 / groupHeight) * 100, 80);
    }, [groupHeight]);

    useEffect(() => {
        let cancelled = false;

        async function loadTerminalHeight() {
            try {
                const response = await fetch("/api/app-settings/deviceTerminalHeight");
                const result = await response.json();
                const savedHeight = Number(result?.value);

                if (!cancelled && Number.isFinite(savedHeight)) {
                    setTerminalHeight(savedHeight);
                }
            } catch (error) {
                return;
            } finally {
                if (!cancelled) {
                    hasLoadedTerminalHeight.current = true;
                }
            }
        }

        loadTerminalHeight();

        return () => {
            cancelled = true;
        };
    }, [setTerminalHeight]);

    useEffect(() => {
        if (!hasLoadedTerminalHeight.current) {
            return;
        }

        fetch("/api/app-settings/deviceTerminalHeight", {
            method: "PUT",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                value: terminalHeight,
            }),
        }).catch(() => {});
    }, [terminalHeight]);

    useEffect(() => {
        if (!isTerminalOpen || !groupHeight || !panelGroupRef.current) {
            return;
        }

        const clampedHeight = Math.min(Math.max(terminalHeight || 320, 180), 600);
        const terminalSize = Math.min(
            Math.max((clampedHeight / groupHeight) * 100, minTerminalSize),
            maxTerminalSize
        );

        panelGroupRef.current.setLayout([100 - terminalSize, terminalSize]);
    }, [groupHeight, isTerminalOpen, maxTerminalSize, minTerminalSize, terminalHeight]);

    const handleTerminalLayout = (layout) => {
        if (!groupHeight || !layout?.length || !isTerminalOpen) {
            return;
        }

        const nextHeight = Math.round((groupHeight * layout[1]) / 100);
        const clampedHeight = Math.min(Math.max(nextHeight, 180), 600);

        if (clampedHeight !== terminalHeight) {
            setTerminalHeight(clampedHeight);
        }
    };

    function handleOpenTerminal() {
        if (!device?.address) {
            setIsTerminalOpen(false);
            if (device?.id) {
                setDeviceTerminalOpen(device.id, false);
            }
            setAvailabilityMessage("SSH connection is not available for this device.");
            return;
        }

        setAvailabilityMessage("");
        setIsTerminalOpen(true);
        if (device?.id) {
            setDeviceTerminalOpen(device.id, true);
        }
    }

    async function handleCloseTerminal() {
        if (device?.id) {
            setDeviceTerminalOpen(device.id, false);
            window.electron?.closeDeviceTerminal?.(device.id).catch(() => {});
        }

        setIsTerminalOpen(false);
        setTerminalError("");
    }

    useEffect(() => {
        if (!router.isReady || !id) {
            return;
        }

        setTerminalError("");
        setAvailabilityMessage("");

        let cancelled = false;

        async function loadDevice() {
            setIsLoading(true);
            setLoadError("");

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
                        const detectedDevices = [
                            ...(detectedResult?.groups?.usb || []),
                            ...(detectedResult?.groups?.bluetooth || []),
                            ...(detectedResult?.groups?.network || []),
                            ...(detectedResult?.connected || []),
                        ];
                        const detectedMatch = findDetectedDeviceMatch(payload, detectedDevices);
                        const preferredNetworkSibling = detectedMatch?.address
                            ? null
                            : findPreferredNetworkSibling(payload, detectedDevices);
                        const resolvedDevice = detectedMatch || preferredNetworkSibling;

                        if (resolvedDevice) {
                            nextDevice = {
                                ...payload,
                                address: resolvedDevice.address ?? payload.address ?? null,
                                port: resolvedDevice.port ?? payload.port ?? null,
                                protocol: resolvedDevice.protocol ?? payload.protocol ?? null,
                                path: resolvedDevice.path ?? payload.path ?? null,
                            };
                        }
                    } catch (error) {
                        nextDevice = payload;
                    }
                }

                setDevice(nextDevice);
                setIsTerminalOpen(Boolean(deviceTerminalOpenById[id]));
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
    }, [deviceTerminalOpenById, id, router.isReady]);

    useEffect(() => {
        if (!isTerminalOpen || !terminalContainerRef.current) {
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
        const sshAddress = device?.address;
        const sshPort = device?.port;

        function safeFit() {
            if (
                disposed ||
                !fitAddon ||
                !terminal ||
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
            if (!terminal || disposed) {
                return;
            }

            disposeRemoteInput();
            disposePasswordInput();
            isConnecting = false;
            passwordBuffer = "";
            setTerminalError("");
            terminal.writeln("");
            terminal.write(`Password for arduino@${sshAddress}: `);

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

                const session = await window.electron.openDeviceTerminal({
                    id: device.id,
                    address: sshAddress,
                    port: sshPort,
                    sshUser: "arduino",
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

                isRemoteConnected = true;
                isConnecting = false;

                if (!session?.reused) {
                    terminal.writeln("");
                }

                attachRemoteInput();
            } catch (error) {
                isConnecting = false;
                isRemoteConnected = false;

                const nextMessage = error?.message || "Unable to open the SSH terminal.";

                if (isAuthErrorMessage(nextMessage) && !password) {
                    promptForPassword();
                    return;
                }

                setTerminalError(nextMessage);
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
            window.requestAnimationFrame(() => {
                safeFit();
            });

            if (!sshAddress) {
                setIsTerminalOpen(false);
                setAvailabilityMessage("SSH connection is not available for this device.");
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
                terminal.writeln(`[ssh] session closed`);
            });

            terminal.writeln(`$ ssh arduino@${sshAddress}`);
            setTerminalError("");
            await openSshSession();

            handleResize = () => {
                if (!fitAddon || !terminal) {
                    return;
                }

                if (!safeFit()) {
                    return;
                }

                if (!isRemoteConnected) {
                    return;
                }

                window.electron.resizeDeviceTerminal(device.id, {
                    cols: terminal.cols,
                    rows: terminal.rows,
                }).catch(() => {});
            };

            window.addEventListener("resize", handleResize);
            resizeObserver = new ResizeObserver(() => {
                window.requestAnimationFrame(handleResize);
            });
            resizeObserver.observe(terminalElement);
        }

        mountTerminal().catch((error) => {
            setTerminalError(error?.message || "Unable to open the SSH terminal.");
        });

        return () => {
            disposed = true;

            removeTerminalDataListener?.();
            removeTerminalExitListener?.();
            disposeRemoteInput();
            disposePasswordInput();
            resizeObserver?.disconnect();

            if (handleResize) {
                window.removeEventListener("resize", handleResize);
            }

            if (terminal) {
                terminal.dispose();
            }

            terminalElement.innerHTML = "";
        };
    }, [device, isTerminalOpen]);

    return (
        <Layout title={device?.alias || device?.name || <div>
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-neutral-500 animate-spin !h-[14px] !w-[14px] lucide lucide-loader-circle-icon lucide-loader-circle"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
        </div>} buttons={
            isTerminalOpen
                ? <div
                    onClick={handleCloseTerminal}
                    className="cursor-pointer rounded-md p-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-black dark:hover:bg-neutral-800 dark:hover:text-white"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="!h-[14px] !w-[14px] lucide lucide-panel-bottom-close-icon lucide-panel-bottom-close"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 15h18"/><path d="m15 8-3 3-3-3"/></svg>
                </div>
                : <div disabled={device?.alias || device?.name}
                    onClick={handleOpenTerminal}
                    className="cursor-pointer rounded-md p-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-black dark:hover:bg-neutral-800 dark:hover:text-white"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="!h-[14px] !w-[14px] lucide lucide-panel-bottom-open-icon lucide-panel-bottom-open"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 15h18"/><path d="m9 10 3-3 3 3"/></svg>
                </div>
        }>
            <div ref={pageContainerRef} className="h-full overflow-hidden">
                <ResizablePanelGroup
                    ref={panelGroupRef}
                    direction="vertical"
                    className="h-full overflow-hidden"
                    onLayout={handleTerminalLayout}
                >
                    <ResizablePanel defaultSize={100} className="min-h-0">
                        <div className="relative h-full overflow-y-auto">
                            {isLoading ? null : null}
                            {loadError ? (
                                <div className="flex max-w-[720px] flex-col gap-2">
                                    <h2 className="text-lg font-semibold">Device not found</h2>
                                    <p className="text-sm text-neutral-500">
                                        {loadError}
                                    </p>
                                </div>
                            ) : null}
                            {availabilityMessage ? (
                                <div className="p-6">
                                    <div className="absolute bottom-6 right-6 rounded-lg border border-amber-900 bg-amber-950/40 px-2.5 py-1.5 text-xs font-medium text-amber-300">
                                        {availabilityMessage}
                                    </div>
                                </div>
                            ) : null}
                        </div>
                    </ResizablePanel>
                    {isTerminalOpen ? (
                        <>
                            <ResizableHandle className="px-3 !bg-transparent after:hidden data-[panel-group-direction=vertical]:!bg-transparent">
                                <span className="z-10 inline-flex w-full items-center justify-center">
                                    <div className="h-1 w-12 rounded-full bg-neutral-300 dark:bg-neutral-600 hover:bg-blue-600" />
                                </span>
                            </ResizableHandle>
                            <ResizablePanel
                                defaultSize={30}
                                minSize={minTerminalSize}
                                maxSize={maxTerminalSize}
                                className="min-h-[200px] max-h-[600px] overflow-hidden"
                            >
                                <div className="h-full w-full p-3">
                                    <div className="relative h-full w-full overflow-hidden rounded-lg border border-neutral-800 bg-black">
                                        {terminalError ? (
                                            <div className="absolute left-3 right-3 top-3 z-10 rounded-md border border-red-900 bg-red-950/40 px-3 py-2 text-xs font-semibold text-red-300">
                                                {terminalError}
                                            </div>
                                        ) : null}
                                        <div ref={terminalContainerRef} className="h-full w-full overflow-hidden bg-black" />
                                    </div>
                                </div>
                            </ResizablePanel>
                        </>
                    ) : null}
                </ResizablePanelGroup>
            </div>
        </Layout>
    );
}

const mapStateToProps = (state) => ({
    terminalHeight: state.ui?.terminalHeight ?? 320,
    deviceTerminalOpenById: state.ui?.deviceTerminalOpenById ?? {},
});

const mapDispatchToProps = {
    setDeviceTerminalOpen,
    setTerminalHeight,
};

export default connect(mapStateToProps, mapDispatchToProps)(DevicePage);
