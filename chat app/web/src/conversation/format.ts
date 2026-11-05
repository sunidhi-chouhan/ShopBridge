export function formatMessageTime(sentTime: number): string {
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(sentTime);
}

export function isSystemEvent(text: string): boolean {
  return text.startsWith("Update ·");
}

export function systemEventCopy(text: string): string {
  return text.replace(/^Update ·\s*/, "");
}
