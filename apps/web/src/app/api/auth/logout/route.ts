import { authRoute } from "@/lib/auth/deps";
import { handleLogout } from "@/lib/auth/handlers";

export const POST = authRoute(handleLogout);
