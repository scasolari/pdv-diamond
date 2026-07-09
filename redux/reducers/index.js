import { combineReducers } from "redux";
import { persistReducer } from "redux-persist";
import session from "redux-persist/lib/storage/session";
import storage from "redux-persist/lib/storage";
import profile from "@/redux/reducers/profile";
import ui from "@/redux/reducers/ui";

// WHITELIST
const persistConfig = {
    key: "root",
    storage: session,
    whitelist: ["profile"]
};

const uiPersistConfig = {
    key: "ui",
    storage,
    whitelist: ["sidebarWidth"]
};

const rootReducer = combineReducers({
    profile: profile,
    ui: persistReducer(uiPersistConfig, ui),
});

const persistedReducer = persistReducer(persistConfig, rootReducer);

export default persistedReducer;
