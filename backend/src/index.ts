import express from "express"
import cors from "cors"
import dotenv from "dotenv"
import cookieParser from "cookie-parser"

import authRoutes from "./auth/authRoutes"
import homeRoutes from "./routes/home"
import providerRoutes from "./routes/providers"
import searchRoutes from "./routes/search"
import listsRoutes from "./routes/lists"
import browseRoutes from "./routes/browse"

dotenv.config()

const app = express()

// With Vite proxy you can keep this permissive in dev.
// Cookies require credentials=true.
app.use(cors({ origin: true, credentials: true }))

app.use(express.json())
app.use(cookieParser())

app.get("/health", (_req, res) => res.json({ ok: true }))

app.use("/api/auth", authRoutes)
app.use("/api", homeRoutes)
app.use("/api", providerRoutes)
app.use("/api", searchRoutes)
app.use("/api", listsRoutes)
app.use("/api", browseRoutes)

const port = Number(process.env.PORT ?? 4000)
app.listen(port, () => console.log(`Backend running on http://localhost:${port}`))
