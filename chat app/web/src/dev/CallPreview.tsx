/**
 * DEVELOPMENT ONLY (never in the production bundle): renders the call screen in each
 * state for visual review while Nexconn calling is not active for the App Key.
 * Nothing here talks to Nexconn or opens devices — it is a picture of the UI, labelled as such.
 * Open with `npm run dev` → http://localhost:5173/#/__calls?phase=incoming&media=video
 */
import { useEffect, useState } from "react";
import type { CallState } from "../chat/calls";
import { CallScreen, type CallActions } from "../inbox/CallScreen";
import "../inbox/inbox.css";

const noop = () => undefined;
const actions: CallActions = {
  accept: noop,
  end: noop,
  mic: noop,
  cam: noop,
  requestVideo: noop,
  cancelVideo: noop,
  answerSwitch: noop,
  mini: noop,
  retry: noop,
  voiceInstead: noop,
  dismiss: noop,
  openDevices: noop,
  place: noop,
  registerLocal: noop,
  registerRemote: noop,
};

function fixture(params: URLSearchParams): CallState {
  const phase = (params.get("phase") ?? "incoming") as CallState["phase"];
  const media = params.get("media") === "video" ? "video" : "audio";
  return {
    callId: phase === "lobby" || phase === "failed" ? null : "preview",
    peerId: "preview-peer",
    media,
    phase,
    direction: params.get("dir") === "in" || phase === "incoming" ? "in" : "out",
    startedAt: phase === "connected" ? Date.now() - 154_000 : null,
    mic: params.get("mic") !== "off",
    cam: media === "video" && params.get("cam") !== "off",
    mini: false,
    context: { orderId: "odemosari", channelId: "preview", title: "Banarasi silk sari" },
    remoteCamOff: params.get("remoteCam") === "off",
    remoteMicOff: params.get("remoteMic") === "off",
    switchRequest: params.get("ask") ? { transactionId: "t", video: true } : null,
    switchPending: false,
    weak: params.get("weak") === "1",
    offline: params.get("offline") === "1",
    peerLevel: params.get("speaking") ? 40 : 0,
    demo: params.get("demo") === "1",
    ended: phase === "ended" ? { label: params.get("label") ?? "Call ended", bad: params.get("bad") === "1", seconds: 154 } : null,
    failure:
      phase === "failed"
        ? params.get("why") === "mic"
          ? { title: "Microphone access is blocked", detail: "Allow the microphone for this site (the icon next to the address bar), then try again.", code: "NotAllowedError", canRetry: true, offerVoice: false }
          : params.get("why") === "cam"
            ? { title: "No camera found", detail: "Connect a camera, or make a voice call instead.", code: "NotFoundError", canRetry: true, offerVoice: true }
            : { title: "Calling isn't switched on yet", detail: "Nexconn voice and video calling is not active for this app key, so the call was not placed. Chat keeps working.", code: "80006", canRetry: false, offerVoice: false }
        : null,
    notice: params.get("notice"),
  };
}

export function CallPreview() {
  const [hash, setHash] = useState(window.location.hash);
  useEffect(() => {
    const onHash = () => setHash(window.location.hash);
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  const params = new URLSearchParams(hash.split("?")[1] ?? "");
  const call = fixture(params);
  return (
    <>
      <CallScreen call={call} peer={{ name: "Meera Joshi", role: "Seller" }} link={params.get("link") === "connecting" ? "connecting" : "connected"} now={Date.now()} actions={actions} preview />
      <p
        style={{ position: "fixed", left: 12, bottom: 8, zIndex: 200, margin: 0, font: "600 11px/1.4 system-ui", color: "#f0b54a", letterSpacing: "0.08em", textTransform: "uppercase" }}
      >
        UI preview · not a call · dev build only
      </p>
    </>
  );
}
