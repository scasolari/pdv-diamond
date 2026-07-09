import "@/styles/globals.css";
import {SessionProvider} from "next-auth/react";
import {Provider} from "react-redux";
import {PersistGate} from "redux-persist/integration/react";
import {store, persistor} from "@/redux";
import {ThemeProvider, useTheme} from "next-themes";
import {useEffect} from "react";

function ElectronThemeSync() {
    const { theme, resolvedTheme } = useTheme();

    useEffect(() => {
        if (!theme || !resolvedTheme) {
            return;
        }

        window.electron?.syncTheme?.({
            theme,
            resolvedTheme,
        });
    }, [resolvedTheme, theme]);

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
