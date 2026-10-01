import type { NextRequest } from "next/server";
import { handleResolveReviewItem } from "@/lib/admin/review-queue/handler";
import { getReviewQueueHandlerDeps } from "@/lib/admin/review-queue/server";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try {
    return await handleResolveReviewItem(request, await getReviewQueueHandlerDeps(), id);
  } catch (error) {
    console.error(
      "Review queue route failed:",
      error instanceof Error ? error.message : "unknown error",
    );
    return Response.json({ message: "Something went wrong" }, { status: 500 });
  }
}
