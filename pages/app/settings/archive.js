import Layout from "@/components/layout";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";

export default function Archive() {
    const [archivedDevices, setArchivedDevices] = useState([]);
    const [deviceToRestore, setDeviceToRestore] = useState(null);

    useEffect(() => {
        let cancelled = false;

        async function loadArchivedDevices() {
            try {
                const response = await fetch("/api/devices?archived=true");
                const result = await response.json();

                if (!cancelled && response.ok) {
                    setArchivedDevices(Array.isArray(result) ? result : []);
                }
            } catch (error) {
                if (!cancelled) {
                    setArchivedDevices([]);
                }
            }
        }

        loadArchivedDevices();

        return () => {
            cancelled = true;
        };
    }, []);

    async function handleRestoreDevice() {
        if (!deviceToRestore) {
            return;
        }

        try {
            const response = await fetch(`/api/devices/${deviceToRestore.id}`, {
                method: "PATCH",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    archived: false,
                }),
            });

            if (!response.ok) {
                return;
            }

            setArchivedDevices((currentDevices) =>
                currentDevices.filter((device) => device.id !== deviceToRestore.id)
            );
            setDeviceToRestore(null);
        } catch (error) {
            return;
        }
    }

    return (
        <Layout title="Settings">
            <div className="m-auto flex w-full max-w-[900px] flex-col gap-4 p-6">
                <div>
                    <h2 className="font-semibold text-[10px] uppercase text-neutral-500">
                        Archive
                    </h2>
                </div>
                <div className="flex flex-col gap-2">
                    {archivedDevices.length ? (
                        archivedDevices.map((device) => (
                            <button
                                key={device.id}
                                type="button"
                                onClick={() => setDeviceToRestore(device)}
                                className="w-fit text-left text-xs font-semibold hover:text-blue-600"
                            >
                                {device.alias || device.name}
                            </button>
                        ))
                    ) : (
                        <div className="text-xs font-semibold text-neutral-500">
                            No archived devices.
                        </div>
                    )}
                </div>
            </div>
            <Dialog
                open={Boolean(deviceToRestore)}
                onOpenChange={(nextOpen) => {
                    if (!nextOpen) {
                        setDeviceToRestore(null);
                    }
                }}
            >
                <DialogContent className="sm:max-w-md p-3">
                    <DialogHeader>
                        <DialogTitle className="font-semibold text-sm">
                            Remove from archive
                        </DialogTitle>
                        <DialogDescription className="font-semibold text-xs">
                            {`Remove ${deviceToRestore?.alias || deviceToRestore?.name} from the archived devices list?`}
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button
                            onClick={() => setDeviceToRestore(null)}
                            className="rounded-lg h-7 !font-semibold !text-xs border bg-white hover:bg-neutral-50 text-black dark:text-white dark:bg-neutral-800 dark:border-neutral-700"
                        >
                            Cancel
                        </Button>
                        <Button
                            onClick={handleRestoreDevice}
                            type="button"
                            className="rounded-lg h-7 !font-semibold !text-xs border border-blue-700 bg-blue-600 hover:bg-blue-700 text-white"
                        >
                            Restore
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </Layout>
    );
}
