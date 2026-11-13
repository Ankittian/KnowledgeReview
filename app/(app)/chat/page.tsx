import type { Metadata } from "next";
import { ChatApp } from "@/components/chat/ChatApp";
import { requireUser } from "@/lib/auth/session";
import { loadChatPage } from "./data";

export const metadata: Metadata = { title: "Assistant" };

export default async function ChatPage() {
  const session = await requireUser();
  const { found: _f, ...data } = await loadChatPage(session, null);
  return <ChatApp key="new" {...data} />;
}
