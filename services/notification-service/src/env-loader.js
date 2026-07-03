import dotenv from "dotenv";
import path from "path";

// 1. Path to the local service .env (e.g., services/payment-service/.env)
const localEnvPath = path.resolve(process.cwd(), ".env");

// 2. Path to the ROOT .env (e.g., online-shop/.env)
// process.cwd() is /services/payment-service, so we go up two levels
const rootEnvPath = path.resolve(process.cwd(), "../../.env");

// 3. Load the Root .env first (Global infrastructure like Redis/MinIO)
dotenv.config({ path: rootEnvPath });

// 4. Load the Local .env second (Service specifics like DATABASE_URL or PORT)
// Local variables will NOT overwrite Root variables if they share the same name.
dotenv.config({ path: localEnvPath });
