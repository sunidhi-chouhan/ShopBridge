/**
 * Voice and video calls with the Nexconn Call SDK (@nexconn/call 26.2.x).
 *
 * Setup order required by the SDK: NCCallEngine.install() → NCEngine.initialize()
 * → NCCallEngine.initialize() → setCallEventHandler(). nexconn.ts calls installCallSdk()
 * and startCallEngine() at the right moments. The SDK is loaded lazily (own bundle chunk).
 *
 * Honesty rules for the UI built on this store:
 * - `phase: "connected"` is only set from the SDK's onCallConnected event.
 * - Remote media is only ever an element the SDK itself attached a stream to.
 * - Permission checks use getUserMedia and stop every track immediately afterwards.
 * - Demo calls (`state.demo`) never touch Nexconn: they exist only on this device, are
 *   labelled "Demo call" on screen, show no remote media and post no call log.
 */
import type { NCCallEngine as Engine, NCCallSession } from "@nexconn/call";

type CallModule = typeof import("@nexconn/call");

export type CallContext = { orderId: string; channelId: string; title: string };

export type CallPhase =
  /** Video pre-call check: local preview + device choice, nothing sent to Nexconn yet. */
  | "lobby"
  /** Checking permissions / asking Nexconn to place the call. */
  | "starting"
  /** Outgoing call is ringing on the other side. */
  | "ringing"
  /** Someone is calling us. */
  | "incoming"
  /** We accepted; waiting for the SDK to report the media connection. */
  | "connecting"
  /** The SDK reported onCallConnected. */
  | "connected"
  /** The call is over; the screen shows why for a moment. */
  | "ended"
  /** The call could not start (permissions, SDK code, configuration). */
  | "failed";

export type CallFailure = {
  title: string;
  detail: string;
  /** Raw Nexconn code or browser error name, for the report and support. */
  code: string;
  canRetry: boolean;
  /** Camera problem on a video call: offer a voice call instead. */
  offerVoice: boolean;
  /** Nexconn Audio & Video is not enabled for this App Key: offer a demo call instead. */
  offerDemo?: boolean;
};

export type CallState = {
  callId: string | null;
  peerId: string;
  media: "audio" | "video";
  phase: CallPhase;
  direction: "in" | "out";
  startedAt: number | null;
  mic: boolean;
  cam: boolean;
  mini: boolean;
  context: CallContext | null;
  remoteCamOff: boolean;
  remoteMicOff: boolean;
  /** The other person asked to turn this voice call into a video call. */
  switchRequest: { transactionId: string; video: boolean } | null;
  /** We asked to switch to video and are waiting for the answer (holds the transaction id). */
  switchPending: string | false;
  /** From the SDK quality handler: the link is losing packets. */
  weak: boolean;
  /** Browser reports no network. */
  offline: boolean;
  /** 0–100 from the SDK volume handler, for the speaking indicator. */
  peerLevel: number;
  ended: { label: string; bad: boolean; seconds: number } | null;
  failure: CallFailure | null;
  /** Short-lived information line ("Asha kept this a voice call"). */
  notice: string | null;
  /** Simulated on this device for presenting; nothing is sent to Nexconn. */
  demo: boolean;
};

export type CallEnded = {
  callId: string;
  peerId: string;
  media: "audio" | "video";
  direction: "in" | "out";
  seconds: number;
  connected: boolean;
  context: CallContext | null;
  reason: number;
  label: string;
  demo: boolean;
};

/** Decides whether an incoming call is allowed (caller belongs to that order conversation). */
export type CallPolicy = {
  selfId: string;
  allow: (callerId: string, context: CallContext | null) => Promise<boolean>;
};

const ENDED_SCREEN_MS = 2600;

let mod: CallModule | null = null;
let engine: Engine | null = null;
let engineError: string | null = null;
let state: CallState | null = null;
let policy: CallPolicy | null = null;
let endedTimer = 0;
let noticeTimer = 0;
/** Calls we already handled (accepted, declined or ignored) so repeated SDK events stay silent. */
const seenCalls = new Set<string>();
const listeners = new Set<(state: CallState | null) => void>();
const endedListeners = new Set<(ended: CallEnded) => void>();
let localVideo: HTMLVideoElement | null = null;
const remoteVideos = new Map<string, HTMLVideoElement>();
/** Device choice from the lobby, applied once the SDK owns the media. */
let preferred: { camera?: string; mic?: string } = {};

function set(next: CallState | null): void {
  state = next;
  for (const listener of listeners) listener(state);
}

function patch(change: Partial<CallState>): void {
  if (state) set({ ...state, ...change });
}

function fresh(base: Pick<CallState, "peerId" | "media" | "phase" | "direction" | "context"> & Partial<CallState>): CallState {
  return {
    callId: null,
    startedAt: null,
    mic: true,
    cam: base.media === "video",
    mini: false,
    remoteCamOff: false,
    remoteMicOff: false,
    switchRequest: null,
    switchPending: false,
    weak: false,
    offline: typeof navigator !== "undefined" ? !navigator.onLine : false,
    peerLevel: 0,
    ended: null,
    failure: null,
    notice: null,
    demo: false,
    ...base,
  };
}

export function callState(): CallState | null {
  return state;
}

export function subscribeCall(listener: (state: CallState | null) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function onCallEnded(listener: (ended: CallEnded) => void): () => void {
  endedListeners.add(listener);
  return () => {
    endedListeners.delete(listener);
  };
}

/** True when the Call SDK initialized. Calls may still be refused by Nexconn (code 80006). */
export function callsAvailable(): boolean {
  return engine !== null;
}

export function setCallPolicy(next: CallPolicy | null): void {
  policy = next;
}

function notice(text: string): void {
  patch({ notice: text });
  window.clearTimeout(noticeTimer);
  noticeTimer = window.setTimeout(() => patch({ notice: null }), 4000);
}

export async function installCallSdk(): Promise<void> {
  if (mod) return;
  mod = await import("@nexconn/call");
  mod.NCCallEngine.install();
}

function parseContext(extra?: string): CallContext | null {
  if (!extra) return null;
  try {
    const value = JSON.parse(extra) as Partial<CallContext>;
    return typeof value.orderId === "string" && typeof value.channelId === "string"
      ? { orderId: value.orderId, channelId: value.channelId, title: typeof value.title === "string" ? value.title.slice(0, 120) : "" }
      : null;
  } catch {
    return null;
  }
}

function mediaOf(session: NCCallSession): "audio" | "video" {
  return mod && session.getMediaType() === mod.NCCallMediaType.AUDIO_VIDEO ? "video" : "audio";
}

/** Human wording for NCCallEndReason. `out` = we placed the call. */
export function endLabel(reason: number, direction: "in" | "out", connected: boolean): { label: string; bad: boolean } {
  switch (reason) {
    case 1000:
      return { label: "Call ended", bad: false };
    case 1001:
      return { label: "No answer", bad: true };
    case 1002:
      return { label: "Missed call", bad: true };
    case 1003:
      return { label: connected ? "Call ended" : "Call cancelled", bad: false };
    case 1004:
      return { label: direction === "out" ? "Call declined" : "You declined the call", bad: direction === "out" };
    case 103:
    case 104:
      return { label: "They are on another call", bad: true };
    case 1010:
    case 1112:
    case 1111:
      return { label: "Ended — you signed in somewhere else", bad: true };
    case 1011:
      return { label: "Answered on another device", bad: false };
    case 1151:
      return { label: "Ended on another device", bad: false };
    case 1113:
    case 1114:
      return { label: "Your other device is already on a call", bad: true };
    case 1110:
    case 1210:
      return { label: "Connection lost", bad: true };
    case 1211:
    case 1212:
    case 1213:
    case 1214:
      return { label: "The other person left the call", bad: true };
    case 1105:
    case 1106:
    case 1107:
    case 1205:
    case 1206:
    case 1207:
      return { label: "The media connection could not be set up", bad: true };
    case 1109:
    case 1209:
      return { label: "The call was stopped by the server", bad: true };
    case 303:
      return { label: "Microphone or camera became unavailable", bad: true };
    case 999:
      return { label: "The call dropped", bad: true };
    default:
      return { label: `Call ended (code ${reason})`, bad: true };
  }
}

function clearViews(): void {
  if (localVideo) localVideo.srcObject = null;
  for (const element of remoteVideos.values()) element.srcObject = null;
  remoteVideos.clear();
}

function finish(callId: string, reason: number): void {
  if (!state || state.callId !== callId || state.phase === "ended") return;
  const connected = state.startedAt !== null;
  const seconds = connected ? Math.max(0, Math.round((Date.now() - state.startedAt!) / 1000)) : 0;
  const { label, bad } = endLabel(reason, state.direction, connected);
  const ended: CallEnded = {
    callId,
    peerId: state.peerId,
    media: state.media,
    direction: state.direction,
    seconds,
    connected,
    context: state.context,
    reason,
    label,
    demo: state.demo,
  };
  if (state.demo) demoStop();
  clearViews();
  preferred = {};
  // A missed incoming call does not take over the screen; the layer shows a notice instead.
  const quiet = ended.direction === "in" && !connected && (reason === 1002 || reason === 1003);
  if (quiet) {
    set(null);
  } else {
    set({ ...state, phase: "ended", ended: { label, bad, seconds }, switchRequest: null, switchPending: false, mini: false });
    window.clearTimeout(endedTimer);
    endedTimer = window.setTimeout(() => {
      if (state?.phase === "ended" && state.callId === callId) set(null);
    }, ENDED_SCREEN_MS);
  }
  for (const listener of endedListeners) listener(ended);
}

/** Close the ended/failed screen now. */
export function dismissCall(): void {
  if (state && (state.phase === "ended" || state.phase === "failed" || state.phase === "lobby")) {
    window.clearTimeout(endedTimer);
    preferred = {};
    set(null);
  }
}

async function decline(callId: string): Promise<void> {
  seenCalls.add(callId);
  await engine?.endCall({ callId }).catch(() => undefined);
}

async function onIncoming(session: NCCallSession, extra?: string): Promise<void> {
  const callId = session.getCallId();
  if (seenCalls.has(callId) || state?.callId === callId) return; // duplicate delivery
  seenCalls.add(callId);
  const callerId = session.getInviterUserId() || session.getCallerUserId();
  const context = parseContext(extra);

  if (policy) {
    const allowed = await policy.allow(callerId, context).catch(() => false);
    if (!allowed) {
      console.warn("[calls] declined a call from someone outside this order conversation", callerId);
      await decline(callId);
      return;
    }
  }

  if (state && state.phase !== "ended" && state.phase !== "failed") {
    // Both people pressed call at the same moment: the user with the larger id gives way
    // and takes the other call instead, so exactly one call survives.
    const glare = state.phase === "ringing" && state.direction === "out" && state.peerId === callerId;
    if (glare && policy && policy.selfId > callerId && state.callId) {
      const mine = state.callId;
      seenCalls.add(mine);
      state = null; // our own call ends silently
      await engine?.endCall({ callId: mine }).catch(() => undefined);
    } else {
      await decline(callId); // busy: the caller sees "declined"
      return;
    }
  }

  window.clearTimeout(endedTimer);
  set(
    fresh({
      callId,
      peerId: callerId,
      media: mediaOf(session),
      phase: "incoming",
      direction: "in",
      context,
    }),
  );
}

export function startCallEngine(): void {
  if (!mod || engine) return;
  const m = mod;
  try {
    engine = m.NCCallEngine.initialize({ logOutputLevel: m.NCCallLogLevel.WARN });
  } catch (caught) {
    engine = null;
    engineError = caught instanceof Error ? caught.message : String(caught);
    return;
  }
  engine.setCallEventHandler({
    onCallReceived({ session, extra }) {
      void onIncoming(session, extra);
    },
    onCallConnected({ session }) {
      if (!state || state.callId !== session.getCallId()) return;
      patch({ phase: "connected", startedAt: state.startedAt ?? Date.now(), media: mediaOf(session) });
      applyPreferredDevices();
      attachViews();
    },
    onStartTimeReceived({ startTime }) {
      // Server time the call room opened: both sides show the same duration.
      if (state?.phase === "connected" && startTime > 0 && startTime <= Date.now()) patch({ startedAt: startTime });
    },
    onCallEnded({ session, reason }) {
      finish(session.getCallId(), reason);
    },
    onRemoteUserStateChanged({ callId, userId, userState }) {
      if (!state || state.callId !== callId) return;
      if (userState === m.NCCallUserState.ONCALL) attachRemote(userId);
    },
    onRemoteCameraStateChanged({ callId, disabled }) {
      if (state?.callId === callId) patch({ remoteCamOff: disabled });
    },
    onRemoteMicrophoneStateChanged({ callId, disabled }) {
      if (state?.callId === callId) patch({ remoteMicOff: disabled });
    },
    onMediaTypeChangeRequestReceived({ transactionId, mediaType }) {
      patch({ switchRequest: { transactionId, video: mediaType === m.NCCallMediaType.AUDIO_VIDEO } });
    },
    onMediaTypeChangeResultReceived({ mediaType, result }) {
      if (result === m.NCCallMediaTypeChangeResult.SERVER_ALLOW_MEDIA_TYPE) {
        const video = mediaType === m.NCCallMediaType.AUDIO_VIDEO;
        patch({ media: video ? "video" : "audio", cam: video, switchRequest: null, switchPending: false });
        attachViews();
        return;
      }
      const asked = Boolean(state?.switchPending);
      patch({ switchRequest: null, switchPending: false });
      if (!asked) return;
      if (result === m.NCCallMediaTypeChangeResult.REFUSE_CHANGE_MEDIA_TYPE) notice("They kept this a voice call");
      else if (result === m.NCCallMediaTypeChangeResult.CHANGE_MEDIA_TYPE_TIMEOUT) notice("No answer to the video request");
    },
  });
  engine.setConnectionQualityHandler({
    onAudioVolumeChanged(volumes) {
      if (!state || state.phase !== "connected") return;
      const level = Math.round(volumes[state.peerId] ?? 0);
      // Only re-render when it crosses the speaking threshold, not on every sample.
      if ((level > 12) !== (state.peerLevel > 12)) patch({ peerLevel: level });
    },
    onReceiveQualityChanged(stats) {
      if (!state || state.phase !== "connected") return;
      const s = stats[state.peerId];
      if (!s) return;
      const loss = Math.max(s.audioPacketLostRate ?? 0, state.media === "video" ? (s.videoPacketLostRate ?? 0) : 0);
      const weak = loss >= 15;
      if (weak !== state.weak) patch({ weak });
    },
  });
}

/** Why calls are unavailable, if the Call SDK did not initialize. */
export function callEngineError(): string | null {
  return engineError;
}

/** The call screen registers its <video> elements here (use stable ref callbacks). */
export function registerLocalVideo(element: HTMLVideoElement | null): void {
  if (element === localVideo) return;
  localVideo = element;
  if (element && state?.demo) {
    element.srcObject = state.cam ? demoStream : null;
    return;
  }
  if (element && engine && state?.cam && state.callId) engine.setLocalVideoView({ videoElement: element });
}

export function registerRemoteVideo(userId: string, element: HTMLVideoElement | null): void {
  if (element) {
    if (remoteVideos.get(userId) === element) return;
    remoteVideos.set(userId, element);
    attachRemote(userId);
  } else {
    remoteVideos.delete(userId);
  }
}

function attachRemote(userId: string): void {
  const element = remoteVideos.get(userId);
  if (engine && element && state?.callId) engine.setRemoteVideoView([{ userId, videoElement: element }]);
}

function attachViews(): void {
  if (!engine || !state?.callId) return;
  if (localVideo && state.cam) engine.setLocalVideoView({ videoElement: localVideo });
  attachRemote(state.peerId);
}

function applyPreferredDevices(): void {
  if (!engine) return;
  const e = engine;
  if (preferred.camera) void e.selectVideoInputDevice({ deviceId: preferred.camera }).catch(() => undefined);
  if (preferred.mic) void e.selectAudioInputDevice({ deviceId: preferred.mic }).catch(() => undefined);
}

/** Map a getUserMedia error to wording people can act on. */
export function mediaFailure(error: unknown, video: boolean): CallFailure {
  const name = error instanceof DOMException || error instanceof Error ? error.name : "Error";
  const device = video ? "camera and microphone" : "microphone";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return {
      title: `${video ? "Camera" : "Microphone"} access is blocked`,
      detail: `Allow the ${device} for this site (the icon next to the address bar), then try again.`,
      code: name,
      canRetry: true,
      offerVoice: false,
    };
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return {
      title: video ? "No camera found" : "No microphone found",
      detail: video ? "Connect a camera, or make a voice call instead." : "Connect a microphone or headset, then try again.",
      code: name,
      canRetry: true,
      offerVoice: video,
    };
  }
  if (name === "NotReadableError" || name === "AbortError") {
    return {
      title: `Your ${video ? "camera" : "microphone"} is busy`,
      detail: "Another app or tab is using it. Close that app, then try again.",
      code: name,
      canRetry: true,
      offerVoice: video,
    };
  }
  return {
    title: "Could not open your devices",
    detail: error instanceof Error && error.message ? error.message : "The browser did not allow media access.",
    code: name,
    canRetry: true,
    offerVoice: false,
  };
}

/** Ask for permission and release the devices straight away (the SDK captures its own stream). */
async function checkDevices(video: boolean): Promise<void> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw Object.assign(new Error("This browser cannot make calls (no media device access). Open ShopBridge over HTTPS in Chrome, Edge, Firefox or Safari."), { name: "NotSupportedError" });
  }
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video });
  for (const track of stream.getTracks()) track.stop();
}

function sdkFailure(code: number): CallFailure {
  const m = mod!;
  if (code === m.NCCallCode.VOIP_SERVICE_UNAVAILABLE) {
    return {
      title: "Calling isn't switched on yet",
      detail: "Nexconn voice and video calling is not active for this app key, so the call was not placed. Chat keeps working.",
      code: String(code),
      canRetry: false,
      offerVoice: false,
      offerDemo: true,
    };
  }
  if (code === m.NCCallCode.ON_CALLING) {
    return { title: "Already on a call", detail: "Finish the other call (maybe in another tab) first.", code: String(code), canRetry: true, offerVoice: false };
  }
  if (code === m.NCCallCode.CHAT_DISCONNECTED) {
    return { title: "Not connected", detail: "Chat is reconnecting. Try again in a moment.", code: String(code), canRetry: true, offerVoice: false };
  }
  return { title: "The call could not start", detail: `Nexconn returned code ${code}.`, code: String(code), canRetry: true, offerVoice: false };
}

function busy(): boolean {
  return state !== null && state.phase !== "ended" && state.phase !== "failed";
}

/**
 * Begin a call from an order conversation. Video calls open the pre-call check first;
 * voice calls go straight to Nexconn after the microphone permission check.
 */
export async function requestCall(peerId: string, video: boolean, context: CallContext): Promise<void> {
  if (busy()) throw new Error("You are already on a call.");
  window.clearTimeout(endedTimer);
  set(fresh({ peerId, media: video ? "video" : "audio", phase: video ? "lobby" : "starting", direction: "out", context }));
  if (!video) await placeCall({});
}

/** Called from the lobby (or directly for voice). The lobby has already released its preview stream. */
export async function placeCall(choice: { camera?: string; mic?: string; cam?: boolean; mic_on?: boolean; skipCheck?: boolean }): Promise<void> {
  if (!state || (state.phase !== "lobby" && state.phase !== "starting" && state.phase !== "failed")) return;
  const draft = state;
  const video = draft.media === "video";
  preferred = { camera: choice.camera, mic: choice.mic };
  set({ ...draft, phase: "starting", failure: null, cam: video && choice.cam !== false, mic: choice.mic_on !== false });

  if (demoCalls || draft.demo) {
    demoPlace();
    return;
  }
  if (!engine || !mod) {
    patch({
      phase: "failed",
      failure: {
        title: "Calling is unavailable",
        detail: engineError ? `The Nexconn Call SDK did not start: ${engineError}` : "Chat has not finished connecting yet. Try again in a moment.",
        code: "ENGINE",
        canRetry: true,
        offerVoice: false,
      },
    });
    return;
  }
  try {
    if (!choice.skipCheck) await checkDevices(video);
  } catch (caught) {
    patch({ phase: "failed", failure: mediaFailure(caught, video) });
    return;
  }
  if (!state || state.phase !== "starting") return; // cancelled meanwhile
  const m = mod;
  // Device choice is applied after onCallConnected: the SDK rejects it (80003) before a call exists.
  let result: Awaited<ReturnType<Engine["startCall"]>>;
  try {
    result = await engine.startCall({
      calleeIds: [draft.peerId],
      callType: m.NCCallType.SINGLE,
      mediaType: video ? m.NCCallMediaType.AUDIO_VIDEO : m.NCCallMediaType.AUDIO,
      extra: JSON.stringify(draft.context),
    });
  } catch (caught) {
    patch({ phase: "failed", failure: { title: "The call could not start", detail: caught instanceof Error ? caught.message : "Unknown error", code: "THROW", canRetry: true, offerVoice: false } });
    return;
  }
  if (result.code !== m.NCCallCode.SUCCESS || !result.callId) {
    console.warn("[calls] startCall refused", result.code);
    patch({ phase: "failed", failure: sdkFailure(result.code) });
    return;
  }
  seenCalls.add(result.callId);
  if (!state || state.phase !== "starting") {
    // Cancelled while Nexconn was placing it: hang up for real.
    await engine.endCall({ callId: result.callId }).catch(() => undefined);
    return;
  }
  patch({ callId: result.callId, phase: "ringing" });
  if (choice.mic_on === false) await engine.enableMicrophone(false).catch(() => undefined);
  if (video && choice.cam === false) await engine.enableCamera(false).catch(() => undefined);
  attachViews();
}

/** Turn a failed video attempt into a voice call to the same person. */
export async function retryAsVoice(): Promise<void> {
  if (!state || (state.phase !== "failed" && state.phase !== "lobby")) return;
  set({ ...state, media: "audio", cam: false, phase: "starting", failure: null });
  await placeCall({});
}

export async function retryCall(): Promise<void> {
  if (!state || state.phase !== "failed") return;
  if (state.media === "video") {
    set({ ...state, phase: "lobby", failure: null });
    return;
  }
  await placeCall({});
}

export async function acceptCall(withVideo: boolean): Promise<void> {
  if (!state || state.phase !== "incoming" || !state.callId) return;
  if (state.demo) {
    demoAccept(withVideo);
    return;
  }
  if (!engine || !mod) throw new Error("Calling is unavailable right now.");
  const e = engine;
  const callId = state.callId;
  const wantsVideo = withVideo && state.media === "video";
  try {
    await checkDevices(wantsVideo);
  } catch (caught) {
    const failure = mediaFailure(caught, wantsVideo);
    if (wantsVideo && failure.offerVoice) {
      // No usable camera: answer with voice only rather than not at all.
      notice(`${failure.title}. Answering with voice only.`);
      return acceptCall(false);
    }
    throw new Error(`${failure.title}. ${failure.detail}`);
  }
  patch({ phase: "connecting" });
  const result = await e.acceptCall({ callId });
  if (result.code !== mod.NCCallCode.SUCCESS) {
    patch({ phase: "incoming" });
    throw new Error(result.code === mod.NCCallCode.VOIP_SERVICE_UNAVAILABLE ? sdkFailure(result.code).title : `Could not answer (code ${result.code}).`);
  }
  if (!wantsVideo && state?.media === "video") {
    await e.enableCamera(false).catch(() => undefined);
    patch({ cam: false });
  }
  attachViews();
}

export async function endCall(): Promise<void> {
  if (!state) return;
  if (state.phase === "lobby" || state.phase === "failed" || state.phase === "ended") {
    dismissCall();
    return;
  }
  if (state.phase === "starting" && !state.callId) {
    // Nexconn has not returned a call id yet: placeCall hangs up when it does.
    set(null);
    return;
  }
  const id = state.callId!;
  if (state.demo) {
    finish(id, state.startedAt ? 1000 : state.direction === "in" ? 1004 : 1003);
    return;
  }
  try {
    await engine?.endCall({ callId: id });
  } finally {
    // The SDK normally reports onCallEnded; this covers a failed hang-up request.
    finish(id, state?.startedAt ? 1000 : state?.direction === "in" ? 1004 : 1003);
  }
}

export async function toggleMic(): Promise<void> {
  if (state?.demo && state.callId) {
    patch({ mic: !state.mic });
    return;
  }
  if (!state?.callId || !engine) return;
  const next = !state.mic;
  const result = await engine.enableMicrophone(next);
  if (result.code !== 0) throw new Error(`Microphone could not be ${next ? "turned on" : "muted"} (code ${result.code}).`);
  patch({ mic: next });
}

export async function toggleCamera(): Promise<void> {
  if (state?.demo && state.callId) {
    const on = !state.cam;
    patch({ cam: on });
    await demoCamera(on);
    return;
  }
  if (!state?.callId || !engine) return;
  const next = !state.cam;
  const result = await engine.enableCamera(next);
  if (result.code !== 0) throw new Error(`Camera could not be turned ${next ? "on" : "off"} (code ${result.code}).`);
  patch({ cam: next });
  if (next) attachViews();
}

export async function requestVideo(): Promise<void> {
  if (state?.demo && state.callId && !state.switchPending) {
    patch({ switchPending: "demo" });
    demoLater(1800, () => {
      if (!state?.demo || !state.switchPending) return;
      patch({ media: "video", cam: true, switchPending: false });
      void demoCamera(true);
      notice("They turned on video (demo)");
    });
    return;
  }
  if (!state?.callId || !engine || !mod || state.switchPending) return;
  const result = await engine.requestChangeMediaType({ mediaType: mod.NCCallMediaType.AUDIO_VIDEO });
  if (result.code !== 0) throw new Error(`Video could not be requested (code ${result.code}).`);
  patch({ switchPending: result.transactionId ?? "pending" });
}

export async function cancelVideoRequest(): Promise<void> {
  if (state?.demo) {
    patch({ switchPending: false });
    return;
  }
  if (!state?.switchPending || !engine) return;
  const transactionId = state.switchPending;
  await engine.cancelChangeMediaType({ transactionId }).catch(() => undefined);
  patch({ switchPending: false });
}

export async function answerSwitch(agree: boolean): Promise<void> {
  if (state?.demo && state.switchRequest) {
    patch(agree ? { media: "video", cam: true, switchRequest: null } : { switchRequest: null });
    if (agree) await demoCamera(true);
    return;
  }
  if (!state?.switchRequest || !engine) return;
  const { transactionId } = state.switchRequest;
  if (agree) {
    try {
      await checkDevices(true);
    } catch (caught) {
      await engine.replyChangeMediaType({ transactionId, isAgreed: false }).catch(() => undefined);
      patch({ switchRequest: null });
      const failure = mediaFailure(caught, true);
      throw new Error(`${failure.title}. ${failure.detail}`);
    }
  }
  await engine.replyChangeMediaType({ transactionId, isAgreed: agree });
  if (agree) {
    patch({ media: "video", cam: true, switchRequest: null });
    attachViews();
  } else {
    patch({ switchRequest: null });
  }
}

export function setMini(mini: boolean): void {
  if (state?.phase === "connected" || state?.phase === "ringing" || state?.phase === "connecting") patch({ mini });
}

export type CallDevices = { cameras: MediaDeviceInfo[]; mics: MediaDeviceInfo[]; speakers: MediaDeviceInfo[] };

/** Devices for the in-call settings menu (labels need an earlier permission grant). */
export async function listDevices(): Promise<CallDevices> {
  if (engine) {
    const [cameras, mics, speakers] = await Promise.all([
      engine.getVideoInputDevices().catch(() => []),
      engine.getAudioInputDevices().catch(() => []),
      engine.getAudioOutputDevices().catch(() => []),
    ]);
    return { cameras, mics, speakers };
  }
  const all = (await navigator.mediaDevices?.enumerateDevices?.().catch(() => [])) ?? [];
  return {
    cameras: all.filter((d) => d.kind === "videoinput"),
    mics: all.filter((d) => d.kind === "audioinput"),
    speakers: all.filter((d) => d.kind === "audiooutput"),
  };
}

export async function selectDevice(kind: "camera" | "mic" | "speaker", deviceId: string): Promise<void> {
  if (state?.demo) return;
  if (!engine || !mod) return;
  // Remember camera/mic for the next connected call; the SDK rejects switches with 80003 before then.
  if (kind === "camera") preferred = { ...preferred, camera: deviceId };
  if (kind === "mic") preferred = { ...preferred, mic: deviceId };
  if (state?.phase !== "connected" && kind !== "speaker") {
    return;
  }
  const result =
    kind === "camera"
      ? await engine.selectVideoInputDevice({ deviceId })
      : kind === "mic"
        ? await engine.selectAudioInputDevice({ deviceId })
        : await engine.selectAudioOutputDevice({ deviceId });
  if (result.code === mod.NCCallCode.NOT_IN_CALL) {
    // Stash already updated; applyPreferredDevices() runs on onCallConnected.
    return;
  }
  if (result.code !== 0) throw new Error(`That device could not be selected (code ${result.code}).`);
}

/** Sign-out / page close: hang up instead of leaving the other person on a dead line. */
export async function hangUpForExit(): Promise<void> {
  if (!state) return;
  if (state.demo) demoStop();
  else if (state.callId && state.phase !== "ended") await engine?.endCall({ callId: state.callId }).catch(() => undefined);
  window.clearTimeout(endedTimer);
  clearViews();
  set(null);
}

if (typeof window !== "undefined") {
  window.addEventListener("online", () => patch({ offline: false }));
  window.addEventListener("offline", () => patch({ offline: true }));
  window.addEventListener("pagehide", () => {
    if (state?.callId && state.phase !== "ended" && !state.demo) void engine?.endCall({ callId: state.callId }).catch(() => undefined);
  });
}

// ── Demo calls ────────────────────────────────────────────────────────────────
// Nexconn voice/video is a paid Audio & Video service. When it is not enabled for the App Key,
// presenters can switch on demo calls: the same call screens run on this device only. The
// caller's own camera preview is real (getUserMedia); the other person is simulated, no media
// or signalling leaves the browser, and no call log is written to the conversation.

const DEMO_KEY = "shopbridge.demoCalls";
const demoListeners = new Set<() => void>();
let demoCalls = readDemoSetting();
let demoTimers: number[] = [];
let demoStream: MediaStream | null = null;
let demoLevelTimer = 0;

function readDemoSetting(): boolean {
  try {
    return typeof localStorage !== "undefined" && localStorage.getItem(DEMO_KEY) === "1";
  } catch {
    return false;
  }
}

/** Whether the call buttons place demo calls instead of Nexconn calls (this device only). */
export function demoCallsEnabled(): boolean {
  return demoCalls;
}

export function setDemoCalls(on: boolean): void {
  demoCalls = on;
  try {
    if (on) localStorage.setItem(DEMO_KEY, "1");
    else localStorage.removeItem(DEMO_KEY);
  } catch {
    // Private mode: applies for this visit.
  }
  for (const listener of demoListeners) listener();
}

export function subscribeDemoCalls(listener: () => void): () => void {
  demoListeners.add(listener);
  return () => {
    demoListeners.delete(listener);
  };
}

function demoLater(ms: number, task: () => void): void {
  demoTimers.push(window.setTimeout(task, ms));
}

function demoStop(): void {
  for (const timer of demoTimers) window.clearTimeout(timer);
  demoTimers = [];
  window.clearInterval(demoLevelTimer);
  demoLevelTimer = 0;
  for (const track of demoStream?.getTracks() ?? []) track.stop();
  demoStream = null;
  if (localVideo) localVideo.srcObject = null;
}

/** Real local camera preview for a demo video call; the call carries on without it if refused. */
async function demoCamera(on: boolean): Promise<void> {
  if (!on) {
    for (const track of demoStream?.getTracks() ?? []) track.stop();
    demoStream = null;
    if (localVideo) localVideo.srcObject = null;
    return;
  }
  if (!demoStream) {
    try {
      demoStream = (await navigator.mediaDevices?.getUserMedia({ video: true, audio: false })) ?? null;
    } catch {
      demoStream = null;
      notice("Camera preview unavailable. The demo call continues without it.");
    }
  }
  if (!state?.demo || !state.cam) {
    for (const track of demoStream?.getTracks() ?? []) track.stop();
    demoStream = null;
    return;
  }
  if (localVideo) localVideo.srcObject = demoStream;
}

function demoConnect(): void {
  if (!state?.demo) return;
  patch({ phase: "connected", startedAt: Date.now() });
  // Simulated "speaking" rhythm for the avatar ring.
  window.clearInterval(demoLevelTimer);
  demoLevelTimer = window.setInterval(() => {
    if (state?.demo && state.phase === "connected") patch({ peerLevel: state.remoteMicOff || Math.random() < 0.45 ? 0 : 40 });
  }, 900);
}

function demoPlace(): void {
  if (!state) return;
  const callId = `demo-${Date.now().toString(36)}`;
  patch({ demo: true, callId, phase: "starting", failure: null });
  if (state.media === "video" && state.cam) void demoCamera(true);
  demoLater(700, () => {
    if (state?.callId === callId && state.phase === "starting") patch({ phase: "ringing" });
  });
  demoLater(3200, () => {
    if (state?.callId === callId && state.phase === "ringing") demoConnect();
  });
}

function demoAccept(withVideo: boolean): void {
  if (!state?.demo) return;
  const video = withVideo && state.media === "video";
  patch({ phase: "connecting", cam: video });
  if (video) void demoCamera(true);
  const callId = state.callId;
  demoLater(900, () => {
    if (state?.callId === callId && state.phase === "connecting") demoConnect();
  });
}

/** The failure screen's "Use a demo call instead" (after Nexconn refused with 80006). */
export async function continueAsDemo(): Promise<void> {
  if (!state || state.phase !== "failed") return;
  set({ ...state, demo: true, phase: "starting", failure: null });
  demoPlace();
}

/** Demo controls: ring this device as if the other person in the conversation called. */
export function simulateIncomingCall(peerId: string, media: "audio" | "video", context: CallContext): void {
  if (busy()) throw new Error("Finish the current call first.");
  window.clearTimeout(endedTimer);
  const callId = `demo-${Date.now().toString(36)}`;
  set(fresh({ callId, peerId, media, phase: "incoming", direction: "in", context, demo: true }));
  // Unanswered demo calls end as missed, like a real ring timeout.
  demoLater(45000, () => {
    if (state?.callId === callId && state.phase === "incoming") finish(callId, 1002);
  });
}

export type DemoPeerEvent = "camera" | "mute" | "weak" | "askVideo" | "hangup";

/** Demo controls: make the simulated other person do something during a demo call. */
export function simulatePeer(event: DemoPeerEvent): void {
  if (!state?.demo || !state.callId) return;
  const live = state.phase === "connected";
  if (event === "hangup") {
    finish(state.callId, state.startedAt ? 1000 : state.direction === "out" ? 1004 : 1003);
    return;
  }
  if (!live) return;
  if (event === "camera" && state.media === "video") patch({ remoteCamOff: !state.remoteCamOff });
  if (event === "mute") patch({ remoteMicOff: !state.remoteMicOff, peerLevel: 0 });
  if (event === "weak") patch({ weak: !state.weak });
  if (event === "askVideo" && state.media === "audio" && !state.switchRequest) patch({ switchRequest: { transactionId: "demo", video: true } });
}
