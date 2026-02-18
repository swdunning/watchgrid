//index.ts

import "dotenv/config"
import accountRoutes from "./routes/account"
import titlesRoutes from "./routes/titles"
import express from "express"
import cors from "cors"
import cookieParser from "cookie-parser"
import providerRowsRoutes from "./routes/providerRows"
import genresRoutes from "./routes/genres"
import metaRoutes from "./routes/meta"
import authRoutes from "./auth/authRoutes"
import homeRoutes from "./routes/home"
import providerRoutes from "./routes/providers"
import searchRoutes from "./routes/search"
import listsRoutes from "./routes/lists"
import browseRoutes from "./routes/browse"
import titlesEnsureRoutes from "./routes/titlesEnsure"

const app = express()

app.use(cors({ origin: true, credentials: true }))
app.use(express.json())
app.use(cookieParser())
app.use("/api", providerRowsRoutes)
app.use("/api", accountRoutes)
app.use("/api", titlesRoutes)

app.get("/health", (_req, res) => res.json({ ok: true }))

app.use("/api", genresRoutes)
app.use("/api", metaRoutes)

app.use("/api/auth", authRoutes)
app.use("/api", homeRoutes)
app.use("/api", providerRoutes)
app.use("/api", searchRoutes)
app.use("/api", listsRoutes)
app.use("/api", browseRoutes)
app.use("/api", titlesEnsureRoutes)

const port = Number(process.env.PORT ?? 4000)
app.listen(port, () => console.log(`Backend running on http://localhost:${port}`))
