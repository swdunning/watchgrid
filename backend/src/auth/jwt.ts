import jwt from "jsonwebtoken"

const JWT_SECRET = process.env.JWT_SECRET

export function signToken(payload: { userId: string }) {
	if (!JWT_SECRET) throw new Error("JWT_SECRET missing in backend/.env")
	return jwt.sign(payload, JWT_SECRET, { expiresIn: "7d" })
}

export function verifyToken(token: string): { userId: string } {
	if (!JWT_SECRET) throw new Error("JWT_SECRET missing in backend/.env")
	return jwt.verify(token, JWT_SECRET) as { userId: string }
}
