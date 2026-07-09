const initialState = {};

const profile = (state = initialState, action) => {
    switch (action.type) {
        case 'SET_PROFILE':
            return {
                ...state,
                ...action.payload
            };
        // other cases
        case 'PROFILE_LOGOUT':
            return initialState;
        default:
            return state;
    }
}

export default profile;
