
import {RiLoader5Line} from "react-icons/ri";

export default function Logout() {
    return <>
        <div className="m-auto mt-10 w-fit">
            <div className="flex flex-col items-center gap-3">
                <RiLoader5Line className="animate-spin text-blue-600" size={30}/>
                <p className="text-sm font-semibold">We are logged out you...</p>
            </div>
        </div>
    </>
}
