import { applyMiddleware, compose, createStore } from "redux";
import rootReducer from "./reducers";
import { persistStore } from "redux-persist";
import thunk from "redux-thunk";

// Definisci il middleware
const middleware = [thunk];

// Usa Redux DevTools se disponibile, altrimenti usa compose di Redux
const composeEnhancers =
    (typeof window !== 'undefined' && window.__REDUX_DEVTOOLS_EXTENSION_COMPOSE__) || compose;

// Applica il middleware con spread operator per espandere l'array
const enhancer = composeEnhancers(applyMiddleware(...middleware));

// Crea lo store con il reducer root e l'enhancer
export const store = createStore(rootReducer, enhancer);

// Crea il persistor
export const persistor = persistStore(store);
