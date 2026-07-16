import { combineReducers } from "redux";
import { persistReducer } from "redux-persist";
import session from "redux-persist/lib/storage/session";
import profile from "@/redux/reducers/profile";
import ui from "@/redux/reducers/ui";

// WHITELIST
const persistConfig = {
    key: "root",
    storage: session,
    whitelist: ["profile"]
};

const rootReducer = combineReducers({
    profile: profile,
    ui: ui,
});

const persistedReducer = persistReducer(persistConfig, rootReducer);

export default persistedReducer;
