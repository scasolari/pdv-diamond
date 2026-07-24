import { getToken } from "next-auth/jwt";

export default async function handler(req, res) {
  const session = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });

  if (!session) {
    return res.status(401).json({ message: "User not authenticated" });
  }

  res.status(200).json({ name: "John Doe" });
}
