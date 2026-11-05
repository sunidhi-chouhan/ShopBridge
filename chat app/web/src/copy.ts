import type { HelpKind, RequestStatus } from "../../shared/types";

export const copy = {
  name: "ShopBridge",
  tagline: "Every order is a conversation.",
  place: "Indore",
  signInTitle: "Sign in",
  nameLabel: "Your name",
  emailLabel: "Email",
  passwordLabel: "Password",
  continue: "Sign in",
  createAccount: "Create account",
  haveAccount: "Sign in instead",
  buyerOnly: "New accounts are buyers. Seller and support desks are approved separately.",
  demoKicker: "Explore demo",
  demoLead: "Open a buyer, seller, or support desk. Roles are set on the server.",
  demoBuyer: "Buyer",
  demoSeller: "Seller",
  demoSupport: "Support agent",
  signOut: "Sign out",
  requestTitle: "Contact general support",
  requestLede:
    "This is community help — groceries, transport, or a companion visit. It is not tied to a shop order and opens a separate help room after a seller is assigned. For a purchase issue, open that order conversation and choose Get order support so the agent joins the same order channel.",
  noteLabel: "Anything they should know",
  noteHint: "Optional. A street, a time, or how to find you.",
  sendRequest: "Request general help",
  generalHelpToast: "General help request sent. It is not linked to an order room.",
  orderSupportToast: "Order support requested. An agent will join this order conversation.",
  waiting: "A support agent will assign a seller. This page updates on its own.",
  roomWaiting: "The room opens when a seller is assigned.",
  keysMissing: "The request is saved. Add your Nexconn App Key and App Secret in .env, then open the room.",
  openRoom: "Open Nexconn room",
  assign: "Assign seller",
  volunteerLabel: "Seller",
  markProgress: "Mark in progress",
  markDone: "Mark complete",
  messageLabel: "Message",
  send: "Send",
  emptyChat: "No messages yet. Say hello when you are ready.",
  chatLoading: "Opening the conversation",
  retry: "Try again",
  noRequests: "No requests yet.",
  queue: "Queue",
  yourRequests: "Requests for you",
  another: "Request help again",
};

export function kindLabel(kind: HelpKind): string {
  if (kind === "groceries") return "Groceries";
  if (kind === "transport") return "Medical transport";
  return "Companion visit";
}

export function kindDetail(kind: HelpKind): string {
  if (kind === "groceries") return "Food, medicine, or household supplies.";
  if (kind === "transport") return "A ride to a clinic or pharmacy.";
  return "Someone to sit with you or check in.";
}

export function statusLabel(status: RequestStatus): string {
  if (status === "requested") return "Requested";
  if (status === "assigned") return "Assigned";
  if (status === "in_progress") return "In progress";
  return "Completed";
}
