import Layout from "@/components/layout";
import db from "@/lib/db";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

function InfoRow({ label, value }) {
    if (!value && value !== 0) {
        return null;
    }

    return (
        <div className="flex items-start justify-between gap-6 border-b border-neutral-200 py-3 dark:border-neutral-800">
            <span className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
                {label}
            </span>
            <span className="text-sm font-medium text-right break-all">
                {String(value)}
            </span>
        </div>
    );
}

function getConnectionStatusClasses(status) {
    if (status === "connected") {
        return "bg-emerald-500/15 text-emerald-400 border-emerald-500/30";
    }

    if (status === "connecting" || status === "disconnecting") {
        return "bg-orange-500/15 text-orange-400 border-orange-500/30";
    }

    if (status === "error") {
        return "bg-red-500/15 text-red-400 border-red-500/30";
    }

    return "bg-neutral-500/15 text-neutral-400 border-neutral-500/30";
}

function getConnectionSupport(device) {
    const pathValue = String(device?.path || "").toLowerCase();
    const isPseudoMacPort =
        pathValue === "/dev/tty.bluetooth-incoming-port" ||
        pathValue === "/dev/cu.bluetooth-incoming-port" ||
        pathValue === "/dev/tty.debug-console" ||
        pathValue === "/dev/cu.debug-console";

    if ((device?.type === "network" || device?.transport === "network") && device?.protocol !== "ssh") {
        return {
            supported: false,
            reason: "Questo device di rete non espone ancora una connessione SSH supportata.",
        };
    }

    if ((device?.type === "network" || device?.transport === "network") && device?.protocol === "ssh" && !device?.address) {
        return {
            supported: false,
            reason: "Manca l'indirizzo del device SSH.",
        };
    }

    if (!device?.path) {
        return {
            supported: false,
            reason: "Questo device non espone una porta seriale valida.",
        };
    }

    if (isPseudoMacPort) {
        return {
            supported: false,
            reason: "Questa porta macOS e di sistema e non rappresenta un device reale.",
        };
    }

    return {
        supported: true,
        reason: null,
    };
}

export default function DevicePage({ device }) {
    const [deviceState, setDeviceState] = useState(device);
    const [baudRateInput, setBaudRateInput] = useState(String(device?.baudRate || 115200));
    const [connectionState, setConnectionState] = useState({
        state: "disconnected",
        connected: false,
        transport: "serial",
        baudRate: device?.baudRate || 115200,
        path: device?.path || null,
        lastError: null,
    });
    const [isBusy, setIsBusy] = useState(false);
    const [logs, setLogs] = useState([]);
    const [actionError, setActionError] = useState(null);
    const connectionSupport = getConnectionSupport(deviceState);

    useEffect(() => {
        setDeviceState(device);
        setBaudRateInput(String(device?.baudRate || 115200));
    }, [device]);

    useEffect(() => {
        if (!device?.id) {
            return;
        }

        let cancelled = false;
        let unsubscribeStatus;
        let unsubscribeLog;

        async function loadConnectionState() {
            if (!window?.electron?.getDeviceConnectionState) {
                return;
            }

            try {
                const nextState = await window.electron.getDeviceConnectionState(device.id);

                if (!cancelled && nextState) {
                    setConnectionState(nextState);
                }
            } catch (error) {
                return;
            }
        }

        loadConnectionState();

        if (window?.electron?.onDeviceConnectionStatus) {
            unsubscribeStatus = window.electron.onDeviceConnectionStatus((payload) => {
                if (!cancelled && payload?.deviceId === device.id) {
                    setConnectionState(payload);
                }
            });
        }

        if (window?.electron?.onDeviceConnectionLog) {
            unsubscribeLog = window.electron.onDeviceConnectionLog((payload) => {
                if (!cancelled && payload?.deviceId === device.id) {
                    setLogs((currentLogs) => [...currentLogs, `[${payload.timestamp}] ${payload.message}`].slice(-200));
                }
            });
        }

        return () => {
            cancelled = true;
            unsubscribeStatus?.();
            unsubscribeLog?.();
        };
    }, [device?.id]);

    if (!device) {
        return (
            <Layout title="Device">
                <div className="flex max-w-[720px] flex-col gap-2">
                    <h2 className="text-lg font-semibold">Device non trovato</h2>
                    <p className="text-sm text-neutral-500">
                        Il device richiesto non esiste oppure non e stato ancora salvato.
                    </p>
                </div>
            </Layout>
        );
    }

    async function handleSaveSerialConfig() {
        const nextBaudRate = Number(baudRateInput);

        if (!Number.isInteger(nextBaudRate) || nextBaudRate <= 0) {
            setActionError("Baud rate non valido.");
            return;
        }

        setActionError(null);

        const response = await fetch(`/api/devices/${device.id}`, {
            method: "PATCH",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                baudRate: nextBaudRate,
            }),
        });

        const result = await response.json();

        setDeviceState(result);
        setBaudRateInput(String(result.baudRate || nextBaudRate));
    }

    async function handleConnect() {
        setIsBusy(true);
        setActionError(null);

        try {
            if (!connectionSupport.supported) {
                throw new Error(connectionSupport.reason || "Connessione non supportata per questo device.");
            }

            if (!window?.electron?.connectDevice) {
                throw new Error("Electron API non disponibile.");
            }

            const nextBaudRate = Number(baudRateInput) || deviceState.baudRate || 115200;
            setConnectionState((currentState) => ({
                ...currentState,
                state: "connecting",
                lastError: null,
            }));
            const targetLabel = deviceState.transport === "network"
                ? `${deviceState.address}:${deviceState.port || 22}`
                : `${deviceState.path} at ${nextBaudRate} baud`;
            setLogs((currentLogs) => [
                ...currentLogs,
                `[${new Date().toISOString()}] Connecting to ${targetLabel}`,
            ].slice(-200));

            await window.electron?.connectDevice?.({
                id: deviceState.id,
                path: deviceState.path,
                address: deviceState.address,
                port: deviceState.port,
                protocol: deviceState.protocol,
                transport: deviceState.transport,
                type: deviceState.type,
                baudRate: nextBaudRate,
            });
        } catch (error) {
            const nextMessage = error?.message || "Connessione fallita.";

            setActionError(nextMessage);
            setConnectionState((currentState) => ({
                ...currentState,
                state: "error",
                lastError: nextMessage,
            }));
            setLogs((currentLogs) => [
                ...currentLogs,
                `[${new Date().toISOString()}] Error: ${nextMessage}`,
            ].slice(-200));
        } finally {
            setIsBusy(false);
        }
    }

    async function handleDisconnect() {
        setIsBusy(true);
        setActionError(null);

        try {
            if (!window?.electron?.disconnectDevice) {
                throw new Error("Electron API non disponibile.");
            }

            await window.electron?.disconnectDevice?.(deviceState.id);
        } catch (error) {
            const nextMessage = error?.message || "Disconnessione fallita.";

            setActionError(nextMessage);
            setConnectionState((currentState) => ({
                ...currentState,
                state: "error",
                lastError: nextMessage,
            }));
            setLogs((currentLogs) => [
                ...currentLogs,
                `[${new Date().toISOString()}] Error: ${nextMessage}`,
            ].slice(-200));
        } finally {
            setIsBusy(false);
        }
    }

    return (
        <Layout title={deviceState.alias || deviceState.name || "Device"}>
        </Layout>
    );
}

export async function getServerSideProps(context) {
    const { id } = context.params;

    const device = await db.savedDevice.findUnique({
        where: {
            id,
        },
    });

    return {
        props: {
            device: device
                ? {
                    ...device,
                    baudRate: device.baudRate,
                    archivedAt: device.archivedAt ? device.archivedAt.toISOString() : null,
                    createdAt: device.createdAt.toISOString(),
                    updatedAt: device.updatedAt.toISOString(),
                }
                : null,
        },
    };
}
