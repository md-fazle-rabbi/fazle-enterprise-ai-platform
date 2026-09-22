import { authRoute } from "@/lib/auth/deps";
import { handleLogin } from "@/lib/auth/handlers";

export const GET = authRoute(handleLogin);
