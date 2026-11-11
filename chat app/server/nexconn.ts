import { createHash, randomBytes } from "node:crypto";
import { SYSTEM_USER_ID, SYSTEM_USER_NAME, type HelpKind } from "../shared/types";

type NexconnJson = {
  code?: number;
  msg?: string;
  errorMessage?: string;
  token?: string;
  result?: {
    accessToken?: string;
    userId?: string;
  };
};

/** Group channel already exists — safe to join members and continue. */
const NEXCONN_CHANNEL_EXISTS = 25409;

export class NexconnError extends Error {
  readonly code?: number;

  constructor(message: string, code?: number) {
    super(message);
    this.code = code;
  }
}

function envTrim(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}

export function nexconnConfigured(): boolean {
  return Boolean(envTrim("NEXCONN_APP_KEY") && envTrim("NEXCONN_APP_SECRET"));
}

export function nexconnAppKey(): string {
  const key = envTrim("NEXCONN_APP_KEY");
  if (!key) throw new NexconnError("Nexconn App Key is not set.");
  return key;
}

function apiBase(): string {
  return (envTrim("NEXCONN_API_BASE") || "https://api.sg-light-api.com").replace(/\/$/, "");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Transient / throttle codes we retry during demo provisioning. */
function isRetryableNexconn(code: number | undefined): boolean {
  if (code == null) return true; // network / unreachable
  // 20604 = request frequency too high; 429 / 5xx = transport layer limits.
  return code === 20604 || code === 429 || (code >= 500 && code <= 599);
}

function nexconnDetail(json: NexconnJson | null, fallback: number | string): string {
  const message = json?.errorMessage || json?.msg;
  const code = json?.code ?? fallback;
  return message ? `${code}: ${message}` : String(code);
}

async function signedPostOnce(path: string, body: unknown): Promise<NexconnJson> {
  const appKey = envTrim("NEXCONN_APP_KEY");
  const secret = envTrim("NEXCONN_APP_SECRET");
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
    const code = json?.code ?? response.status;
    throw new NexconnError(`Nexconn request failed (${nexconnDetail(json, response.status)}).`, code);
  }
  return json;
}

async function signedPost(path: string, body: unknown, attempts = 3): Promise<NexconnJson> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await signedPostOnce(path, body);
    } catch (error) {
      last = error;
      const code = error instanceof NexconnError ? error.code : undefined;
      if (i === attempts - 1 || !isRetryableNexconn(code)) throw error;
      await sleep(400 * (i + 1));
    }
  }
  throw last instanceof Error ? last : new NexconnError("Nexconn request failed.");
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
  const userIds = [...new Set(input.memberIds.filter(Boolean))];
  try {
    await signedPost("/v4/group-channel/create", {
      channelId: input.channelId,
      name: input.name.slice(0, 64),
      owner: input.ownerId,
      userIds,
      // 3 = nobody can join on their own; only this server adds members (verified against the live API).
      permissions: { joinPerm: 3, invitePerm: 0 },
    });
  } catch (error) {
    // Idempotent: a prior half-finished reset may have created the channel already.
    if (!(error instanceof NexconnError) || error.code !== NEXCONN_CHANNEL_EXISTS) throw error;
    console.warn(`Nexconn channel ${input.channelId} already exists; joining members instead.`);
    await joinGroupMembers(input.channelId, userIds);
  }
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
  await createGroupChannel({
    channelId,
    name: `Order ${input.productLabel}`.slice(0, 64),
    ownerId: input.buyerId,
    memberIds: [input.buyerId, input.sellerId],
  });
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

let systemUserReady = false;

/** Register the ShopBridge system sender once per process. */
async function ensureSystemUser(): Promise<void> {
  if (systemUserReady) return;
  await issueAccessToken(SYSTEM_USER_ID, SYSTEM_USER_NAME);
  systemUserReady = true;
}

/**
 * Post an order event ("Update · …") from the ShopBridge system user. Clients render a
 * message as a system event only when it comes from this sender.
 */
export async function sendSystemText(channelId: string, text: string): Promise<void> {
  await ensureSystemUser();
  await sendRoomText(SYSTEM_USER_ID, channelId, text);
}

/**
 * Server-sent custom message (offer, tracking card…). Only the server sends these, so a
 * buyer cannot forge a price or a shipment. `fromUserId` null = ShopBridge system user.
 */
export async function sendCustomMessage(
  fromUserId: string | null,
  channelId: string,
  messageType: string,
  content: Record<string, unknown>,
): Promise<void> {
  if (!fromUserId) await ensureSystemUser();
  await signedPost("/v4/group-channel/message/send", {
    fromUserId: fromUserId ?? SYSTEM_USER_ID,
    toChannelIds: [channelId],
    messageType,
    content: JSON.stringify(content),
    shouldPersist: 1,
    isEchoToSender: 1,
  });
}

/** Create one order channel with the given members and replay a scripted conversation into it. */
export async function provisionScriptedChannel(input: {
  channelId: string;
  name: string;
  ownerId: string;
  memberIds: string[];
  lines: Array<{ fromUserId: string | null; text: string; custom?: { type: string; content: Record<string, unknown> } }>;
}): Promise<void> {
  await ensureSystemUser();
  await createGroupChannel({
    channelId: input.channelId,
    name: input.name,
    ownerId: input.ownerId,
    memberIds: input.memberIds,
  });
  for (const line of input.lines) {
    if (line.custom) await sendCustomMessage(line.fromUserId, input.channelId, line.custom.type, line.custom.content);
    else if (line.fromUserId) await sendRoomText(line.fromUserId, input.channelId, line.text);
    else await sendSystemText(input.channelId, line.text);
    // Pace scripted posts so a full demo reset does not trip Nexconn frequency limits.
    await sleep(120);
  }
}

/** Cheap Server API check used before a full demo reset so failures are attributed clearly. */
export async function probeNexconn(): Promise<void> {
  await issueAccessToken(SYSTEM_USER_ID, SYSTEM_USER_NAME);
  systemUserReady = true;
}
