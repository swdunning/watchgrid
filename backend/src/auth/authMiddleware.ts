import type { Request, Response, NextFunction } from "express"
import { verifyToken } from "./jwt"

export function requireAuth(req: Request, res: Response, next: NextFunction) {
	const token = req.cookies?.token
	if (!token) return res.status(401).json({ error: "Not authenticated" })

	try {
		const decoded = verifyToken(token)
		;(req as any).userId = decoded.userId
		next()
	} catch {
		return res.status(401).json({ error: "Invalid session" })
	}
}
