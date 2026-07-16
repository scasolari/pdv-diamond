import "@/styles/globals.css";
import {SessionProvider} from "next-auth/react";
import {Provider} from "react-redux";
import {PersistGate} from "redux-persist/integration/react";
import {store, persistor} from "@/redux";
import {ThemeProvider, useTheme} from "next-themes";
import {useEffect, useState} from "react";

function ElectronThemeSync() {
    const { theme, resolvedTheme, setTheme } = useTheme();
    const [hasLoadedTheme, setHasLoadedTheme] = useState(false);

    useEffect(() => {
        if (hasLoadedTheme) {
            return;
        }

        let cancelled = false;

        async function loadThemePreference() {
            try {
                const response = await fetch("/api/app-settings/theme");
                const result = await response.json();

                if (!cancelled && result?.value) {
                    if (result.value !== theme) {
                        setTheme(result.value);
                    }
                }
            } catch (error) {
                return;
            } finally {
                if (!cancelled) {
                    setHasLoadedTheme(true);
                }
            }
        }

        loadThemePreference();

        return () => {
            cancelled = true;
        };
    }, [hasLoadedTheme, setTheme, theme]);

    useEffect(() => {
        if (!hasLoadedTheme || !theme || !resolvedTheme) {
            return;
        }

        window.electron?.syncTheme?.({
            theme,
            resolvedTheme,
        });

        fetch("/api/app-settings/theme", {
            method: "PUT",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                value: theme,
            }),
        }).catch(() => {});
    }, [hasLoadedTheme, resolvedTheme, theme]);

    return null;
}

export default function App({Component, pageProps}) {
    return <Provider store={store}>
        <SessionProvider>
            <PersistGate loading={null} persistor={persistor}>
              <ThemeProvider attribute="class" disableTransitionOnChange>
                  <ElectronThemeSync />
                  <Component {...pageProps} />
                </ThemeProvider>
            </PersistGate>
        </SessionProvider>
    </Provider>;
}
