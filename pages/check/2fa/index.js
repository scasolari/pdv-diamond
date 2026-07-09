import {InputOTP, InputOTPGroup, InputOTPSlot} from "@/components/ui/input-otp";
import {useState} from "react";
import axios from "axios";
import {useRouter} from "next/router";
import {Button} from "@/components/ui/button";

export default function TwoFALogin() {
    const [value, setValue] = useState("")
    const router = useRouter()

    const check2FA = () => {
        axios.post(`/api/2fa/check`, {
            token: value,
        })
            .then((res) => {
                router.push("/app/dashboard")
            }).catch((err) => {
            console.log(err)
        })
    }

    return <>
        <div className="w-[400px] p-6 py-8 m-auto mt-7 flex flex-col gap-4">
            <div className="mb-4">
                <h3 className="font-semibold text-center mb-2 text-lg">Verify your identity</h3>
                <p className="text-sm text-center text-neutral-500">Enter the six-digit code from your two-factor authenticator app to continue.</p>
            </div>
            <div className="flex flex-col gap-3 items-center">
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
                <Button onClick={() => check2FA()}>Continue Login</Button>
            </div>
        </div>
    </>
}
