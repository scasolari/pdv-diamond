import { ADD_SAVED_DEVICE, SET_SAVED_DEVICES, SET_SIDEBAR_WIDTH } from "@/redux/types";

const initialState = {
    sidebarWidth: 240,
    savedDevices: [],
};

const ui = (state = initialState, action) => {
    switch (action.type) {
        case SET_SIDEBAR_WIDTH:
            return {
                ...state,
                sidebarWidth: action.payload,
            };
        case ADD_SAVED_DEVICE: {
            const nextDevice = action.payload;
            const existingDeviceIndex = state.savedDevices.findIndex((device) => device.id === nextDevice.id);

            if (existingDeviceIndex === -1) {
                return {
                    ...state,
                    savedDevices: [...state.savedDevices, nextDevice],
                };
            }

            return {
                ...state,
                savedDevices: state.savedDevices.map((device, index) =>
                    index === existingDeviceIndex
                        ? {
                            ...device,
                            ...nextDevice,
                        }
                        : device
                ),
            };
        }
        case SET_SAVED_DEVICES:
            return {
                ...state,
                savedDevices: action.payload,
            };
        default:
            return state;
    }
};

export default ui;
