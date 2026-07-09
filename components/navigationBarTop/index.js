import {
    DropdownMenu,
    DropdownMenuContent, DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import Avatar from "boring-avatars";
import Link from "next/link";
import {setProfile} from "@/redux/actions/main";
import {connect} from "react-redux";
import useLogout from "@/lib/logout";

function NavigationBarTop(props) {
    const { profile } = props;
    const logout = useLogout();

    return <>
        <div className="fixed px-4 py-3 border-b w-full flex items-center bg-white dark:bg-neutral-950">
            <div className="flex items-center justify-between w-full">
                <div/>
                <DropdownMenu>
                    <DropdownMenuTrigger className="focus-visible:ring-0 focus-visible:!outline-0">
                        <Avatar name={profile?.user?.name} size={30} variant="beam"/>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent side="bottom" align="end" className="shadow-md w-[260px]">
                        <DropdownMenuLabel>
                            <p>{profile?.user?.name}</p>
                            <p className="text-neutral-500 font-semibold text-sm">{profile?.user?.email}</p>
                        </DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem className="font-semibold hover:cursor-pointer">
                            <Link href="/app/settings">
                                Settings
                            </Link>
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={logout} className="font-semibold hover:cursor-pointer">Logout</DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>
        </div>
    </>
}

const mapStateToProps = (state) => {
    return {
        profile: state.profile,
    };
};

export default connect(mapStateToProps)(NavigationBarTop);
