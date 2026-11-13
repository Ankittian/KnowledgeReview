import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ChatApp } from "@/components/chat/ChatApp";
import { requireUser } from "@/lib/auth/session";
import { loadChatPage } from "../data";

export const metadata: Metadata = { title: "Assistant" };

export default async function ConversationPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireUser();
  const { id } = await params;
  const { found, ...data } = await loadChatPage(session, id);
  if (!found) notFound(); // someone else's or deleted conversation looks exactly like a missing one
  return <ChatApp key={id} {...data} />;
}
