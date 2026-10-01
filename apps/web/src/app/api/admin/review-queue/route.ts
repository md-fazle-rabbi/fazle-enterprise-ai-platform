import type { NextRequest } from "next/server";
import { handleGetReviewQueue } from "@/lib/admin/review-queue/handler";
import { getReviewQueueHandlerDeps } from "@/lib/admin/review-queue/server";

export async function GET(request: NextRequest) {
  try {
    return await handleGetReviewQueue(request, await getReviewQueueHandlerDeps());
  } catch (error) {
    console.error(
      "Review queue route failed:",
      error instanceof Error ? error.message : "unknown error",
    );
    return Response.json({ message: "Something went wrong" }, { status: 500 });
  }
}
