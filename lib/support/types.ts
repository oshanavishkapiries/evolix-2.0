export type SupportMessage = { id: number; text: string; senderRole: "user" | "admin"; createdAt: string };
export type SupportConversation = { id: string; userId: string; status: "open" | "resolved"; email?: string };
export type SupportThread = { conversation: SupportConversation | null; messages: SupportMessage[]; hasMore: boolean; recipientEmail?: string };
export type SupportInboxItem = SupportConversation & { email: string; latestText: string; latestRole: "user" | "admin"; latestId: number; lastAt: string; unread: number };
