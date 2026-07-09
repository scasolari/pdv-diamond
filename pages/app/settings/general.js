import { useEffect, useState } from "react";
import Layout from "@/components/layout";
import {setProfile} from "@/redux/actions/main";
import {connect} from "react-redux";
import { useTheme } from "next-themes";
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import {Button} from "@/components/ui/button";

function General(props) {
    const { profile } = props;
    const { theme, setTheme } = useTheme();
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        setMounted(true);
    }, []);

    return <Layout title="Settings">
        <div className="flex flex-col gap-4 sm:max-w-[900px] w-full m-auto">
            <div>
                <h2 className="font-semibold text-[10px] text-neutral-500 uppercase">
                    General
                </h2>
            </div>
            <div className="flex flex-col gap-4">
                <div className="flex flex-row justify-between items-center">
                    <div className="flex flex-col gap-1">
                        <h3 className="font-semibold text-sm">Theme</h3>
                        <p className="font-semibold text-xs text-neutral-500">Choose how Placedv AI looks across the app.</p>
                    </div>
                    <div>
                        <Select value={mounted ? theme : undefined} onValueChange={setTheme}>
                            <SelectTrigger className=" rounded-lg w-[180px] h-7 !text-xs !font-semibold hover:bg-neutral-50 dark:bg-neutral-800 dark:border-neutral-700">
                                <SelectValue placeholder="Select theme" className="!text-xs !font-semibold"/>
                            </SelectTrigger>
                            <SelectContent>
                                <SelectGroup>
                                    <SelectItem value="system" className="!text-xs !font-semibold">
                                        System
                                    </SelectItem>
                                    <SelectItem value="dark" className="!text-xs !font-semibold">
                                        Dark
                                    </SelectItem>
                                    <SelectItem value="light" className="!text-xs !font-semibold">
                                        Light
                                    </SelectItem>
                                </SelectGroup>
                            </SelectContent>
                        </Select>
                    </div>
                </div>
                <div className="flex flex-row justify-between items-center">
                    <div className="flex flex-col gap-1">
                        <h3 className="font-semibold text-sm">Version</h3>
                        <p className="font-semibold text-xs text-neutral-500">Current version of the application.</p>
                    </div>
                    <div>
                        <Button className="rounded-lg h-7 !font-semibold !text-xs border bg-white hover:bg-neutral-50 text-black dark:text-white dark:bg-neutral-800 dark:border-neutral-700">
                            Up to Date
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    </Layout>
}

const mapStateToProps = (state) => {
    return {
        profile: state.profile,
    };
};

const mapDispatchToProps = {
    setProfile,
};

export default connect(mapStateToProps, mapDispatchToProps)(General);
