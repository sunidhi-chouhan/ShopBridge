import { useEffect, useState } from "react";
import type { PublicUser } from "../../shared/types";
import { ApiError, getMe, isOwnReset, onDemoEpochChange, onUnauthorized, signOut } from "./api";
import { SessionProvider } from "./app/session";
import { disconnectChat } from "./chat/nexconn";
import { PresenceProvider } from "./chat/presence";
import { Shell } from "./components/Shell";
import { copy } from "./copy";
import { AccountPanel } from "./pages/AccountPanel";
import { BuyerOrders } from "./pages/BuyerOrders";
import { InboxPage } from "./inbox/InboxPage";
import { CoordinatorDesk } from "./pages/CoordinatorDesk";
import { SellerOrders } from "./pages/SellerOrders";
import { SellerProducts } from "./pages/SellerProducts";
import { ShopFlow } from "./pages/ShopFlow";
import { SignIn } from "./pages/SignIn";
import { defaultSection, emptyCopy, type Section } from "./ui/nav";
import { navigate } from "./ui/route";
import { ErrorState, EmptyState } from "./ui/StateView";
import { SbLoader } from "./ui/SbLoader";
import { useToast } from "./ui/Toast";

type Gate =
  | { status: "loading" }
  | { status: "signedOut" }
  | { status: "ready"; user: PublicUser }
  | { status: "error"; message: string };

function Screen({
  user,
  section,
  go,
}: {
  user: PublicUser;
  section: Section;
  go: (next: Section) => void;
}) {
  if (user.role === "member" && section === "shop") return <ShopFlow onOpenOrders={() => go("orders")} />;
  if (user.role === "member" && section === "orders") return <BuyerOrders user={user} onShop={() => go("shop")} />;
  if (user.role === "member" && section === "inbox") return <InboxPage user={user} party="buyer" />;
  if (user.role === "member" && section === "account") return <AccountPanel />;
  if (user.role === "volunteer" && section === "orders") return <SellerOrders user={user} onInbox={() => go("inbox")} />;
  if (user.role === "volunteer" && section === "inbox") return <InboxPage user={user} party="seller" />;
  if (user.role === "volunteer" && section === "products") return <SellerProducts />;
  if (user.role === "coordinator" && section === "queue") return <CoordinatorDesk />;
  if (user.role === "coordinator" && section === "inbox") return <InboxPage user={user} party="support" />;
  const empty = emptyCopy(section, user.role);
  return (
    <EmptyState
      title={empty.title}
      detail={empty.detail}
      scene={empty.scene}
      actionLabel={empty.actionLabel}
      onAction={empty.action === section ? undefined : () => go(empty.action)}
    />
  );
}

export function App() {
  const [gate, setGate] = useState<Gate>({ status: "loading" });
  /** Bumped when the shared demo is reset: remounts the signed-in app with fresh data. */
  const [generation, setGeneration] = useState(0);
  const toast = useToast();

  useEffect(() => {
    let alive = true;
    getMe()
      .then((result) => {
        if (alive) setGate({ status: "ready", user: result.user });
      })
      .catch((error: unknown) => {
        if (!alive) return;
        if (error instanceof ApiError && error.status === 401) {
          setGate({ status: "signedOut" });
          return;
        }
        setGate({ status: "error", message: error instanceof Error ? error.message : "Could not open ShopBridge." });
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    return onUnauthorized(() => {
      void disconnectChat();
      setGate({ status: "signedOut" });
    });
  }, []);

  // Someone (maybe another judge) reset the shared demo: refresh everything on screen.
  useEffect(
    () =>
      onDemoEpochChange((epoch) => {
        // Let resetDemo() record its own epoch first (it resolves right after this fires).
        window.setTimeout(() => {
          if (isOwnReset(epoch)) return;
          toast("The shared demo was just restored. Showing the fresh demo data.");
          void getMe()
            .then((result) => setGate({ status: "ready", user: result.user }))
            .catch(() => undefined);
          setGeneration((value) => value + 1);
        }, 0);
      }),
    [toast],
  );

  async function onSignOut() {
    await signOut().catch(() => undefined);
    await disconnectChat();
    setGate({ status: "signedOut" });
  }

  if (gate.status === "loading") {
    return (
      <main className="gate" id="main">
        <SbLoader tone="page" label={`Opening ${copy.name}`} />
      </main>
    );
  }

  if (gate.status === "error") {
    return (
      <main className="gate" id="main">
        <ErrorState message={gate.message} onRetry={() => window.location.reload()} />
      </main>
    );
  }

  if (gate.status === "signedOut") {
    return (
      <SignIn
        onSignedIn={(user) => {
          navigate(defaultSection(user.role));
          setGate({ status: "ready", user });
        }}
      />
    );
  }

  const { user } = gate;
  return (
    <SessionProvider key={`${user.id}:${generation}`} user={user}>
      <PresenceProvider user={user}>
        <Shell
          user={user}
          onSignOut={() => void onSignOut()}
          onDemoReset={() => {
            toast("Demo data restored successfully.");
            void getMe()
              .then((result) => setGate({ status: "ready", user: result.user }))
              .catch(() => undefined);
            navigate(defaultSection(user.role));
            setGeneration((value) => value + 1);
          }}
        >
          {(section, go) => <Screen user={user} section={section} go={go} />}
        </Shell>
      </PresenceProvider>
    </SessionProvider>
  );
}
