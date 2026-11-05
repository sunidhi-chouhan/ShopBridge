import type { Role } from "../../../shared/types";

export type Section = "shop" | "orders" | "inbox" | "account" | "products" | "queue";

export function roleLabel(role: Role): string {
  if (role === "member") return "Buyer";
  if (role === "volunteer") return "Seller";
  return "Support agent";
}

export function defaultSection(role: Role): Section {
  if (role === "member") return "shop";
  if (role === "volunteer") return "products";
  return "queue";
}

export function navItems(role: Role): { id: Section; label: string }[] {
  if (role === "member") {
    return [
      { id: "shop", label: "Shop" },
      { id: "orders", label: "Orders" },
      { id: "inbox", label: "Inbox" },
      { id: "account", label: "Account" },
    ];
  }
  if (role === "volunteer") {
    return [
      { id: "orders", label: "Orders" },
      { id: "inbox", label: "Inbox" },
      { id: "products", label: "Products" },
    ];
  }
  return [
    { id: "queue", label: "Queue" },
    { id: "inbox", label: "Inbox" },
  ];
}

export function emptyCopy(section: Section, role: Role): {
  title: string;
  detail: string;
  actionLabel: string;
  action: Section;
  scene: "shop" | "orders" | "inbox" | "products";
} {
  if (section === "shop") {
    return {
      title: "The salon opens next.",
      detail: "Listings arrive in the next phase. Your conversations are already in Inbox.",
      actionLabel: "Open Inbox",
      action: "inbox",
      scene: "shop",
    };
  }
  if (section === "orders") {
    return {
      title: "No orders on the floor.",
      detail: "Requests you send stay in Inbox until order tracking is added.",
      actionLabel: "Open Inbox",
      action: role === "volunteer" ? "orders" : "inbox",
      scene: "orders",
    };
  }
  if (section === "products") {
    return {
      title: "Your shelf is empty.",
      detail: "The catalogue arrives in the next phase. Assigned requests stay on Orders.",
      actionLabel: "See requests",
      action: "orders",
      scene: "products",
    };
  }
  return {
    title: "No conversation yet.",
    detail: "Open a request in the queue to join its Nexconn room.",
    actionLabel: "Open Queue",
    action: "queue",
    scene: "inbox",
  };
}
