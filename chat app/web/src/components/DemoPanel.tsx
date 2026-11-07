import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { setTheme, useTheme } from "../app/theme";
import {
  callState,
  demoCallsEnabled,
  setDemoCalls,
  simulateIncomingCall,
  simulatePeer,
  subscribeCall,
  subscribeDemoCalls,
  type CallState,
  type DemoPeerEvent,
} from "../chat/calls";
import { usePresence } from "../chat/presence";
import { useRoute } from "../ui/route";
import { useToast } from "../ui/Toast";

/**
 * Presenter controls for features this Nexconn App Key does not include. Voice and video
 * calling is Nexconn's paid Audio & Video service; these controls run the real call screens
 * as a demo on this device only. Every demo surface is labelled, nothing is sent to Nexconn,
 * and nothing is written into the conversation.
 */

type Kind = "live" | "custom" | "demo";
const FEATURES: { feature: string; api: string; kind: Kind }[] = [
  { feature: "Order conversations, presence", api: "NCEngine.connect · DirectChannel", kind: "live" },
  { feature: "Text, photos, reply, read receipts, typing", api: "sendMessage · sendMediaMessage · sendReadReceiptResponse · sendTypingStatus", kind: "live" },
  { feature: "Auto-translation", api: "Nexconn translation (Console)", kind: "live" },
  { feature: "Reactions, edit, offers, tracking", api: "Custom messages SB:Reaction · SB:Edit · SB:Offer · SB:Track", kind: "custom" },
  { feature: "Support escalation and history", api: "ShopBridge server + SB:System messages", kind: "custom" },
  { feature: "Voice and video calls", api: "NCCallEngine startCall · acceptCall (needs paid Audio & Video)", kind: "demo" },
  { feature: "Mute, camera, switch to video", api: "enableMicrophone · enableCamera · requestChangeMediaType", kind: "demo" },
];
const KIND_LABEL: Record<Kind, string> = { live: "Live · Nexconn", custom: "Custom", demo: "Paid · demo" };

function useCall(): CallState | null {
  return useSyncExternalStore(subscribeCall, callState, () => null);
}

function useDemoCalls(): boolean {
  return useSyncExternalStore(subscribeDemoCalls, demoCallsEnabled, () => false);
}

export function DemoPanel() {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const call = useCall();
  const demoCalls = useDemoCalls();
  const presence = usePresence();
  const [route] = useRoute();
  const { theme } = useTheme();
  const toast = useToast();

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    const onDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown);
    };
  }, [open]);

  const conversations = (presence.conversations ?? []).filter((item) => item.channelId);
  const target = conversations.find((item) => item.orderId === route.orderId) ?? conversations[0] ?? null;
  const demoLive = Boolean(call?.demo && call.phase !== "ended" && call.phase !== "failed");
  const connected = demoLive && call?.phase === "connected";
  const busy = Boolean(call && call.phase !== "ended" && call.phase !== "failed");

  function ring(media: "audio" | "video") {
    if (!target?.channelId) return;
    try {
      simulateIncomingCall(target.counterpart.id, media, { orderId: target.orderId, channelId: target.channelId, title: target.title });
      setOpen(false);
    } catch (caught) {
      toast(caught instanceof Error ? caught.message : "Could not start the demo call", "error");
    }
  }

  function peer(event: DemoPeerEvent) {
    simulatePeer(event);
  }

  return (
    <div className={`demo-panel${route.orderId ? " in-chat" : ""}${busy ? " in-call" : ""}`} ref={rootRef}>
      {open ? (
        <section className="demo-sheet" id={panelId} role="dialog" aria-label="Demo controls">
          <header>
            <h2>Demo controls</h2>
            <p>
              Voice and video calling is Nexconn's paid Audio &amp; Video service, which is not enabled for this App Key.
              Demo calls run the real call screens on this device only: nothing is sent to Nexconn and no call is saved to
              the conversation. Your own camera preview is real; the other person is simulated.
            </p>
          </header>

          <label className="demo-switch">
            <input type="checkbox" checked={demoCalls} onChange={(event) => setDemoCalls(event.target.checked)} />
            <span className="demo-switch-ui" aria-hidden="true" />
            <span>
              <b>Call buttons place demo calls</b>
              <small>{demoCalls ? "On for this device. Calls are labelled “Demo call”." : "Off: call buttons use Nexconn (refused with 80006 until Audio & Video is enabled)."}</small>
            </span>
          </label>

          <h3>Incoming call</h3>
          <p className="demo-hint">
            {target ? (
              <>
                From <b>{target.counterpart.name}</b> · {target.title}
              </>
            ) : (
              "No order conversation yet. Place an order first."
            )}
          </p>
          <div className="demo-actions">
            <button type="button" className="demo-btn-sm" disabled={!target || busy} onClick={() => ring("video")}>
              Incoming video call
            </button>
            <button type="button" className="demo-btn-sm" disabled={!target || busy} onClick={() => ring("audio")}>
              Incoming voice call
            </button>
          </div>

          <h3>During a demo call</h3>
          <div className="demo-actions">
            <button type="button" className="demo-btn-sm" disabled={!connected || call?.media !== "video"} aria-pressed={Boolean(call?.remoteCamOff)} onClick={() => peer("camera")}>
              {call?.remoteCamOff ? "Their camera on" : "Their camera off"}
            </button>
            <button type="button" className="demo-btn-sm" disabled={!connected} aria-pressed={Boolean(call?.remoteMicOff)} onClick={() => peer("mute")}>
              {call?.remoteMicOff ? "They unmute" : "They mute"}
            </button>
            <button type="button" className="demo-btn-sm" disabled={!connected || call?.media !== "audio"} onClick={() => peer("askVideo")}>
              They ask for video
            </button>
            <button type="button" className="demo-btn-sm" disabled={!connected} aria-pressed={Boolean(call?.weak)} onClick={() => peer("weak")}>
              {call?.weak ? "Network recovers" : "Weak network"}
            </button>
            <button type="button" className="demo-btn-sm is-end" disabled={!demoLive} onClick={() => peer("hangup")}>
              They hang up
            </button>
          </div>

          <h3>Appearance</h3>
          <div className="demo-actions">
            <button type="button" className="demo-btn-sm" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
              Switch to {theme === "dark" ? "light" : "dark"} theme
            </button>
          </div>

          <h3>Feature → Nexconn</h3>
          <table className="demo-map">
            <tbody>
              {FEATURES.map((row) => (
                <tr key={row.feature}>
                  <td>
                    {row.feature} <span className={`demo-tag is-${row.kind}`}>{KIND_LABEL[row.kind]}</span>
                  </td>
                  <td>
                    <code>{row.api}</code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}
      <button
        type="button"
        className={`demo-pill${demoCalls ? " is-on" : ""}`}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((value) => !value)}
      >
        Demo controls{demoCalls ? " · demo calls on" : ""}
      </button>
    </div>
  );
}
