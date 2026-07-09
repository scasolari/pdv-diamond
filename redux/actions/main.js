import * as t from "../types";

export const setProfile = (profile) => dispatch => {
    dispatch({
        type: t.SET_PROFILE,
        payload: profile
    });
};

export const setSidebarWidth = (width) => dispatch => {
    dispatch({
        type: t.SET_SIDEBAR_WIDTH,
        payload: width
    });
};
