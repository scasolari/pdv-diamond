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

export const addSavedDevice = (device) => dispatch => {
    dispatch({
        type: t.ADD_SAVED_DEVICE,
        payload: device
    });
};

export const setSavedDevices = (devices) => dispatch => {
    dispatch({
        type: t.SET_SAVED_DEVICES,
        payload: devices
    });
};
