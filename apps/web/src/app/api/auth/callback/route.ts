import { authRoute } from "@/lib/auth/deps";
import { handleCallback } from "@/lib/auth/handlers";

export const GET = authRoute(handleCallback);
