import { SET_SIDEBAR_WIDTH } from "@/redux/types";

const initialState = {
    sidebarWidth: 240,
};

const ui = (state = initialState, action) => {
    switch (action.type) {
        case SET_SIDEBAR_WIDTH:
            return {
                ...state,
                sidebarWidth: action.payload,
            };
        default:
            return state;
    }
};

export default ui;
