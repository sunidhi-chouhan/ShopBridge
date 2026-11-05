import { useEffect, useState } from "react";
import type { PublicUser } from "../../shared/types";
import { getMe, onUnauthorized, signOut } from "./api";
import { ApiError } from "./api";
import { Shell } from "./components/Shell";
import { disconnectSaathi } from "./chat/nexconn";
import { copy } from "./copy";
import { AccountPanel } from "./pages/AccountPanel";
import { BuyerOrders } from "./pages/BuyerOrders";
import { ConversationInbox } from "./pages/ConversationInbox";
import { CoordinatorDesk } from "./pages/CoordinatorDesk";
import { SellerOrders } from "./pages/SellerOrders";
import { SellerProducts } from "./pages/SellerProducts";
import { ShopFlow } from "./pages/ShopFlow";
import { SignIn } from "./pages/SignIn";
import { emptyCopy, type Section } from "./ui/nav";
import { ErrorState, EmptyState } from "./ui/StateView";
import { SbLoader } from "./ui/SbLoader";

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
  if (user.role === "member" && section === "inbox") return <ConversationInbox user={user} party="buyer" />;
  if (user.role === "member" && section === "account") return <AccountPanel user={user} />;
  if (user.role === "volunteer" && section === "orders") return <SellerOrders user={user} onInbox={() => go("inbox")} />;
  if (user.role === "volunteer" && section === "inbox") return <ConversationInbox user={user} party="seller" />;
  if (user.role === "volunteer" && section === "products") return <SellerProducts />;
  if (user.role === "coordinator" && section === "queue") return <CoordinatorDesk onInbox={() => go("inbox")} />;
  if (user.role === "coordinator" && section === "inbox") return <ConversationInbox user={user} party="support" />;
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
      void disconnectSaathi();
      setGate({ status: "signedOut" });
    });
  }, []);

  async function onSignOut() {
    await signOut().catch(() => undefined);
    await disconnectSaathi();
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
    return <SignIn onSignedIn={(user) => setGate({ status: "ready", user })} />;
  }

  const { user } = gate;
  return (
    <Shell user={user} onSignOut={() => void onSignOut()}>
      {(section, go) => <Screen user={user} section={section} go={go} />}
    </Shell>
  );
}
