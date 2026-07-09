import Layout from "@/components/layout";
import {Button} from "@/components/ui/button";
import axios from "axios";
import {useState} from "react";
import Image from "next/image";
import {
    AlertDialog,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import {
    InputOTP,
    InputOTPGroup,
    InputOTPSlot,
} from "@/components/ui/input-otp"
import useLogout from "@/lib/logout";
import {useSession} from "next-auth/react";
import { Switch } from "@/components/ui/switch"
import {connect} from "react-redux";
import {Label} from "@/components/ui/label";
import {setProfile} from "@/redux/actions/main";

function Settings(props) {
    const {profile, setProfile} = props;
    const {data: session} = useSession();
    const [qrcode, setQrcode] = useState({});
    const [value, setValue] = useState("")
    const [status, setStatus] = useState(profile?.user?.is2FAEnabled);
    const [loading, setLoading] = useState(false);
    const logout = useLogout();

    const updateStatus2FA = (newStatus) => {
        setLoading(true)
        setStatus(newStatus);
        axios.post(`/api/2fa/status`, {
            status: newStatus // Usa il nuovo valore, non quello dello state
        }).then((res) => {
            setProfile({
                ...profile,
                user: {
                    ...profile.user,
                    is2FAEnabled: newStatus // Usa il nuovo valore anche qui
                }
            });
            setTimeout(function (){
                logout()
            }, 1000)
        })
    }

    const fetch2FASetUp = () => {
        axios.get(`/api/2fa/setup`)
            .then((res) => {
                setQrcode(res.data);
            })
    }

    const verifyCode2fa = () => {
        axios.post(`/api/2fa/verify`, {
            token: value,
            secret: qrcode.secret
        }).then((res) => {
            logout()
        }).catch((err) => {
            console.log(err.message)
        })
    }

    return <Layout title="Settings">
        <div>
            {profile?.user?.is2FAActive
                ? <>
                    <div className="flex flex-col gap-4">
                        <h3 className="font-semibold">Two-factor authentication</h3>
                        <div className="w-[500px] flex flex-col gap-3">
                            <div className="flex flex-row gap-3 w-full items-center justify-between">
                                <Label htmlFor="2fa" className="text-sm font-semibold">
                                    Activate 2FA
                                </Label>
                                <Switch
                                    disabled={loading}
                                    checked={status}
                                    onCheckedChange={(e) => updateStatus2FA(e)} // Rimuovi il !
                                    id="2fa"
                                    className="shadow-none"
                                />
                            </div>
                            <div className="text-sm font-semibold text-neutral-500">
                                Use an authentication app to get a verification code to log into your account safely. You will be logged out.
                            </div>
                        </div>
                    </div>
                </>
                : <AlertDialog>
                    <AlertDialogTrigger>
                        <Button onClick={() => fetch2FASetUp()} variant="secondary" className="border !text-sm !font-semibold">
                            Activate 2FA
                        </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                        <AlertDialogHeader>
                            <AlertDialogTitle>2FA Setup</AlertDialogTitle>
                        </AlertDialogHeader>
                        <div className="flex flex-col gap-3">
                            <p className="text-sm font-semibold">
                                Scan the image below with the 2FA authenticator app on your phone.
                            </p>
                            <div className="flex w-full">
                                <Image src={qrcode.qrCodeImage} alt="QR Code" width="200" height="200" className="border rounded-md bg-neutral-50"/>
                            </div>
                            <p className="text-sm font-semibold">
                                or, manually enter the code below in the 2FA authenticator app on your phone.
                            </p>
                            <p className="text-sm font-semibold text-center p-2 w-full rounded bg-neutral-50 border border-neutral-100 font-mono">
                                {qrcode.secret}
                            </p>
                        </div>
                        <div className="flex flex-col gap-3">
                            <p className="text-sm font-semibold">
                                Enter the six-digit code from the application
                            </p>
                            <div>
                                <InputOTP maxLength={6} value={value} onChange={(value) => setValue(value)}>
                                    <InputOTPGroup>
                                        <InputOTPSlot index={0} />
                                        <InputOTPSlot index={1} />
                                        <InputOTPSlot index={2} />
                                        <InputOTPSlot index={3} />
                                        <InputOTPSlot index={4} />
                                        <InputOTPSlot index={5} />
                                    </InputOTPGroup>
                                </InputOTP>
                            </div>
                        </div>
                        <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <Button onClick={() => verifyCode2fa()}>Continue</Button>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>
            }
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

export default connect(mapStateToProps, mapDispatchToProps)(Settings);
