import type { NextRequest } from "next/server";
import { handleGetKillSwitch, handlePostKillSwitch } from "@/lib/admin/kill-switch/handler";
import { getKillSwitchHandlerDeps } from "@/lib/admin/kill-switch/server";

export async function GET(request: NextRequest) {
  try {
    return await handleGetKillSwitch(request, await getKillSwitchHandlerDeps());
  } catch (error) {
    console.error(
      "Kill switch route failed:",
      error instanceof Error ? error.message : "unknown error",
    );
    return Response.json({ message: "Something went wrong" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    return await handlePostKillSwitch(request, await getKillSwitchHandlerDeps());
  } catch (error) {
    console.error(
      "Kill switch route failed:",
      error instanceof Error ? error.message : "unknown error",
    );
    return Response.json({ message: "Something went wrong" }, { status: 500 });
  }
}
