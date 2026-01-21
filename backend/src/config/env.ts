import path from "path"
import dotenv from "dotenv"

// Always load backend/.env (regardless of where you run the command from)
dotenv.config({ path: path.resolve(__dirname, "../../.env") })
