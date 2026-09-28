import type { NextRequest } from "next/server";
import { handleSetTenant } from "@/lib/tenant/handler";
import { getTenantHandlerDeps } from "@/lib/tenant/server";

export async function POST(request: NextRequest) {
  try {
    return await handleSetTenant(request, getTenantHandlerDeps());
  } catch (error) {
    console.error("Tenant route failed:", error instanceof Error ? error.message : "unknown error");
    return Response.json({ message: "Something went wrong" }, { status: 500 });
  }
}
