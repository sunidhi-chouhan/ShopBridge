import { createHash, randomBytes } from "node:crypto";
import type { HelpKind } from "../shared/types";

type NexconnJson = {
  code?: number;
  msg?: string;
  token?: string;
  result?: {
    accessToken?: string;
    userId?: string;
  };
};

export class NexconnError extends Error {
  constructor(message: string) {
    super(message);
  }
}

export function nexconnConfigured(): boolean {
  return Boolean(process.env.NEXCONN_APP_KEY && process.env.NEXCONN_APP_SECRET);
}

export function nexconnAppKey(): string {
  const key = process.env.NEXCONN_APP_KEY;
  if (!key) throw new NexconnError("Nexconn App Key is not set.");
  return key;
}

function apiBase(): string {
  return (process.env.NEXCONN_API_BASE || "https://api.sg-light-api.com").replace(/\/$/, "");
}

async function signedPost(path: string, body: unknown): Promise<NexconnJson> {
  const appKey = process.env.NEXCONN_APP_KEY;
  const secret = process.env.NEXCONN_APP_SECRET;
  if (!appKey || !secret) throw new NexconnError("Nexconn keys are not set.");

  const nonce = randomBytes(9).toString("hex").slice(0, 18);
  const timestamp = Date.now().toString();
  const signature = createHash("sha1").update(`${secret}${nonce}${timestamp}`).digest("hex");

  let response: Response;
  try {
    response = await fetch(`${apiBase()}${path}`, {
      method: "POST",
      headers: {
        "App-Key": appKey,
        Nonce: nonce,
        Timestamp: timestamp,
        Signature: signature,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch {
    throw new NexconnError("Could not reach Nexconn.");
  }

  const json = (await response.json().catch(() => null)) as NexconnJson | null;
  if (!json || (json.code !== 0 && json.code !== 200)) {
    throw new NexconnError(`Nexconn request failed (${json?.code ?? response.status}).`);
  }
  return json;
}

export async function issueAccessToken(userId: string, name: string): Promise<string> {
  const json = await signedPost("/v4/auth/access-token/issue", { userId, name });
  const token = json.result?.accessToken ?? json.token;
  if (!token) throw new NexconnError("Nexconn did not return an access token.");
  return token;
}

export function orderChannelId(orderId: string): string {
  return `order${orderId}`;
}

async function createGroupChannel(input: {
  channelId: string;
  name: string;
  ownerId: string;
  memberIds: string[];
}): Promise<void> {
  await signedPost("/v4/group-channel/create", {
    channelId: input.channelId,
    name: input.name.slice(0, 64),
    owner: input.ownerId,
    userIds: input.memberIds,
    permissions: { joinPerm: 1, invitePerm: 0 },
  });
}

/** Add members directly via Server API. Docs: POST /v4/group-channel/join */
export async function joinGroupMembers(channelId: string, userIds: string[]): Promise<void> {
  const unique = [...new Set(userIds.filter(Boolean))];
  if (unique.length === 0) return;
  await signedPost("/v4/group-channel/join", { channelId, userIds: unique });
}

export async function createHelpRoom(input: {
  channelId: string;
  kind: HelpKind;
  ownerId: string;
  memberId: string;
  volunteerId: string;
}): Promise<void> {
  const label =
    input.kind === "groceries" ? "Groceries" : input.kind === "transport" ? "Transport" : "Companion visit";
  await createGroupChannel({
    channelId: input.channelId,
    name: `${label} help`,
    ownerId: input.ownerId,
    memberIds: [input.memberId, input.volunteerId],
  });
}

export async function createOrderRoom(input: {
  orderId: string;
  buyerId: string;
  sellerId: string;
  productLabel: string;
}): Promise<string> {
  const channelId = orderChannelId(input.orderId);
  const name = `Order ${input.productLabel}`.slice(0, 64);
  try {
    await createGroupChannel({
      channelId,
      name,
      ownerId: input.buyerId,
      memberIds: [input.buyerId, input.sellerId],
    });
  } catch (error) {
    // Idempotent retry: channel may already exist from a prior attempt.
    await joinGroupMembers(channelId, [input.buyerId, input.sellerId]);
    if (!(error instanceof NexconnError)) throw error;
  }
  return channelId;
}

export async function sendRoomText(fromUserId: string, channelId: string, text: string): Promise<void> {
  await signedPost("/v4/group-channel/message/send", {
    fromUserId,
    toChannelIds: [channelId],
    messageType: "RC:TxtMsg",
    content: JSON.stringify({ content: text }),
    shouldPersist: 1,
    isEchoToSender: 1,
  });
}
