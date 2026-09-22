export type ChatGPTImportTurn = {
  role: "user" | "assistant";
  text: string;
};

export type ChatGPTImportConversation = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  turns: ChatGPTImportTurn[];
};

type ExportMessage = {
  author?: { role?: unknown };
  content?: { parts?: unknown };
  create_time?: unknown;
};

type ExportNode = {
  id?: unknown;
  parent?: unknown;
  message?: ExportMessage | null;
};

type ExportConversation = {
  id?: unknown;
  conversation_id?: unknown;
  title?: unknown;
  create_time?: unknown;
  update_time?: unknown;
  current_node?: unknown;
  mapping?: unknown;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function isoTime(value: unknown, fallback: string): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    const milliseconds = value > 10_000_000_000 ? value : value * 1000;
    const date = new Date(milliseconds);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  if (typeof value === "string") {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  return fallback;
}

function textFromParts(value: unknown): string {
  if (!Array.isArray(value)) return "";
  return value
    .map((part) => {
      if (typeof part === "string") return part;
      const record = asRecord(part);
      if (!record) return "";
      if (typeof record.text === "string") return record.text;
      if (typeof record.content === "string") return record.content;
      return "";
    })
    .filter(Boolean)
    .join("\n")
    .replace(/\s+/g, " ")
    .trim();
}

function turnFromNode(node: ExportNode): (ChatGPTImportTurn & { createdAt: number }) | null {
  const message = node.message;
  const role = message?.author?.role;
  if (role !== "user" && role !== "assistant") return null;
  const text = textFromParts(message?.content?.parts).slice(0, 8_000);
  if (!text) return null;
  const createdAt =
    typeof message?.create_time === "number" && Number.isFinite(message.create_time)
      ? message.create_time
      : 0;
  return { role, text, createdAt };
}

function extractTurns(conversation: ExportConversation): ChatGPTImportTurn[] {
  const mappingRecord = asRecord(conversation.mapping);
  if (!mappingRecord) return [];
  const mapping = new Map<string, ExportNode>();
  Object.entries(mappingRecord).forEach(([id, raw]) => {
    const record = asRecord(raw);
    if (record) mapping.set(id, record as ExportNode);
  });

  const chain: ExportNode[] = [];
  let cursor = typeof conversation.current_node === "string" ? conversation.current_node : "";
  const seen = new Set<string>();
  while (cursor && !seen.has(cursor) && mapping.has(cursor)) {
    seen.add(cursor);
    const node = mapping.get(cursor)!;
    chain.push(node);
    cursor = typeof node.parent === "string" ? node.parent : "";
  }

  const source = chain.length
    ? chain.reverse()
    : Array.from(mapping.values()).sort((a, b) => {
        const left = typeof a.message?.create_time === "number" ? a.message.create_time : 0;
        const right = typeof b.message?.create_time === "number" ? b.message.create_time : 0;
        return left - right;
      });

  return source
    .map(turnFromNode)
    .filter((turn): turn is ChatGPTImportTurn & { createdAt: number } => Boolean(turn))
    .slice(-4)
    .map(({ role, text }) => ({ role, text }));
}

function conversationArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  const record = asRecord(value);
  if (!record) return [];
  if (Array.isArray(record.conversations)) return record.conversations;
  if (Array.isArray(record.items)) return record.items;
  return [];
}

export function parseChatGPTExport(value: unknown): ChatGPTImportConversation[] {
  const now = new Date().toISOString();
  const conversations = conversationArray(value)
    .map((raw): ChatGPTImportConversation | null => {
      const record = asRecord(raw) as ExportConversation | null;
      if (!record) return null;
      const id =
        typeof record.id === "string"
          ? record.id.trim()
          : typeof record.conversation_id === "string"
            ? record.conversation_id.trim()
            : "";
      if (!id || id.length > 240) return null;
      const turns = extractTurns(record);
      const createdAt = isoTime(record.create_time, now);
      const updatedAt = isoTime(record.update_time, createdAt);
      const fallbackTitle = turns.find((turn) => turn.role === "user")?.text.slice(0, 52);
      const title =
        typeof record.title === "string" && record.title.trim()
          ? record.title.trim().slice(0, 240)
          : fallbackTitle || "未命名 ChatGPT 对话";
      return { id, title, createdAt, updatedAt, turns };
    })
    .filter((item): item is ChatGPTImportConversation => Boolean(item));

  const unique = new Map<string, ChatGPTImportConversation>();
  conversations.forEach((conversation) => {
    const current = unique.get(conversation.id);
    if (!current || conversation.updatedAt > current.updatedAt) {
      unique.set(conversation.id, conversation);
    }
  });
  return Array.from(unique.values()).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
