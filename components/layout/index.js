import { useEffect, useMemo, useRef, useState } from "react";
import NavigationBar from "@/components/navigationBar";
import {
    ResizableHandle,
    ResizablePanel,
    ResizablePanelGroup,
} from "@/components/ui/resizable";
import { connect } from "react-redux";
import { setSidebarWidth } from "@/redux/actions/main";

function Layout({ children, title, sidebarWidth, setSidebarWidth }) {
    const containerRef = useRef(null);
    const panelGroupRef = useRef(null);
    const [groupWidth, setGroupWidth] = useState(0);
    const hasLoadedSidebarWidth = useRef(false);

    useEffect(() => {
        const updateWidth = () => {
            setGroupWidth(containerRef.current?.clientWidth ?? 0);
        };

        updateWidth();
        window.addEventListener("resize", updateWidth);

        return () => {
            window.removeEventListener("resize", updateWidth);
        };
    }, []);

    const minSidebarSize = useMemo(() => {
        if (!groupWidth) {
            return 14;
        }
        return (240 / groupWidth) * 100;
    }, [groupWidth]);

    const maxSidebarSize = useMemo(() => {
        if (!groupWidth) {
            return 28;
        }
        return Math.min((600 / groupWidth) * 100, 80);
    }, [groupWidth]);

    useEffect(() => {
        let cancelled = false;

        async function loadSidebarWidth() {
            try {
                const response = await fetch("/api/app-settings/sidebarWidth");
                const result = await response.json();
                const savedWidth = Number(result?.value);

                if (!cancelled && Number.isFinite(savedWidth)) {
                    setSidebarWidth(savedWidth);
                }
            } catch (error) {
                return;
            } finally {
                if (!cancelled) {
                    hasLoadedSidebarWidth.current = true;
                }
            }
        }

        loadSidebarWidth();

        return () => {
            cancelled = true;
        };
    }, [setSidebarWidth]);

    useEffect(() => {
        if (!hasLoadedSidebarWidth.current) {
            return;
        }

        fetch("/api/app-settings/sidebarWidth", {
            method: "PUT",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                value: sidebarWidth,
            }),
        }).catch(() => {});
    }, [sidebarWidth]);

    useEffect(() => {
        if (!groupWidth || !panelGroupRef.current) {
            return;
        }

        const clampedWidth = Math.min(Math.max(sidebarWidth || 240, 240), 600);
        const sidebarSize = Math.min(
            Math.max((clampedWidth / groupWidth) * 100, minSidebarSize),
            maxSidebarSize
        );

        panelGroupRef.current.setLayout([sidebarSize, 100 - sidebarSize]);
    }, [groupWidth, maxSidebarSize, minSidebarSize, sidebarWidth]);

    const handleLayout = (layout) => {
        if (!groupWidth || !layout?.length) {
            return;
        }

        const nextWidth = Math.round((groupWidth * layout[0]) / 100);
        const clampedWidth = Math.min(Math.max(nextWidth, 240), 600);

        if (clampedWidth !== sidebarWidth) {
            setSidebarWidth(clampedWidth);
        }
    };

    return <div ref={containerRef} className="h-screen overflow-hidden">
        <ResizablePanelGroup ref={panelGroupRef} direction="horizontal" className="h-screen overflow-hidden" onLayout={handleLayout}>
            <ResizablePanel defaultSize={18} minSize={minSidebarSize} maxSize={maxSidebarSize} className="min-w-[240px] max-w-[600px]">
                <NavigationBar title={title}/>
            </ResizablePanel>
            <ResizableHandle />
            <ResizablePanel defaultSize={82} className="min-w-0 overflow-hidden">
                <div className="flex h-full min-w-0 flex-1 flex-col overflow-hidden">
                    <div
                        className="px-6 flex h-11 w-full shrink-0 items-center border-b bg-transparent backdrop-blur-md"
                        style={{ WebkitAppRegion: "drag" }}
                    >
                        <span className="font-semibold text-sm">{title}</span>
                    </div>
                    <div className="min-h-0 flex-1 overflow-y-auto p-6 w-full">
                        {children}
                    </div>
                </div>
            </ResizablePanel>
        </ResizablePanelGroup>
    </div>
}

const mapStateToProps = (state) => ({
    sidebarWidth: state.ui?.sidebarWidth ?? 240,
});

const mapDispatchToProps = {
    setSidebarWidth,
};

export default connect(mapStateToProps, mapDispatchToProps)(Layout);
