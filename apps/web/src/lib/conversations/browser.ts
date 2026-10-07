import * as z from "zod";
import { chatResultSchema } from "@/lib/chat/events";

// The shapes /api/conversations sends to the browser (see lib/conversations/handler.ts).
export const conversationListSchema = z.object({
  conversations: z.array(z.object({ id: z.guid(), title: z.string(), updatedAt: z.string() })),
});
export type ConversationSummary = z.infer<typeof conversationListSchema>["conversations"][number];

export const conversationDetailSchema = z.object({
  id: z.guid(),
  title: z.string(),
  messages: z.array(
    z.object({
      id: z.guid(),
      role: z.enum(["user", "assistant"]),
      content: z.string(),
      // null when the stored result no longer matches today's schema: shown as plain text.
      result: chatResultSchema.nullable(),
      createdAt: z.string(),
    }),
  ),
});
export type ConversationDetail = z.infer<typeof conversationDetailSchema>;
