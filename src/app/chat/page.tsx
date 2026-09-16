import { pageMetadata } from "@/seo/metadata";
import Chat from "./chat";

export const metadata = pageMetadata("/chat");

export default function ChatPage() {
  return <Chat />;
}
