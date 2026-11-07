/**
 * Canonical ShopBridge demo data — the single source used by:
 *  - `npm run seed` / dev reseed (full local wipe), and
 *  - the shared "Reset demo data" action (scoped to demo records only).
 *
 * Product ids are fixed so a reset is repeatable. Order and request ids are generated
 * fresh on each build so every reset gets brand-new Nexconn channels (`order{orderId}`)
 * containing only the scripted showcase conversation.
 */
import { randomBytes } from "node:crypto";
import { imagesForProductName, PRODUCT_IMAGES } from "../shared/catalog";
import type { Category, Language, OrderStatus, RequestStatus, Resolution, Role } from "../shared/types";
import type { OrderRecord, ProductRecord, RequestRecord } from "./store-types";

export const DEMO_PARTIES = ["buyer", "seller", "support"] as const;
export type DemoParty = (typeof DEMO_PARTIES)[number];

export const DEMO_ACCOUNTS: Record<DemoParty, { email: string; name: string; role: Role; language: Language }> = {
  buyer: { email: "buyer@shopbridge.demo", name: "Asha Rao", role: "member", language: "hi" },
  seller: { email: "seller@shopbridge.demo", name: "Meera Joshi", role: "volunteer", language: "en" },
  support: { email: "support@shopbridge.demo", name: "Kabir Shah", role: "coordinator", language: "en" },
};

export const DEMO_EMAILS = DEMO_PARTIES.map((party) => DEMO_ACCOUNTS[party].email);

type ProductSeed = {
  id: string;
  name: string;
  description: string;
  category: Category;
  price: number;
  stock: number;
  featured: boolean;
};

export const DEMO_PRODUCTS: ProductSeed[] = [
  {
    id: "pdemosari",
    name: "Maheshwari cotton sari",
    description: "Handwoven cotton with a narrow zari border. Drapes light, made for everyday wear in warm weather.",
    category: "textile",
    price: 4800,
    stock: 6,
    featured: true,
  },
  {
    id: "pdemotote",
    name: "Cane and hide tote",
    description: "Woven cane body with a vegetable-tanned hide collar and short handles. Unlined, meant to soften with use.",
    category: "leather",
    price: 3700,
    stock: 4,
    featured: false,
  },
  {
    id: "pdemobowl",
    name: "Stoneware serving bowl",
    description: "Wheel-thrown bowl in a sand glaze. Holds a family dal or a pile of fruit. Dishwasher safe.",
    category: "tableware",
    price: 1850,
    stock: 9,
    featured: false,
  },
  {
    id: "pdemojhumka",
    name: "Hammered brass jhumkas",
    description: "Bell earrings in unlacquered brass. Light enough for all-day wear. Wipe with a dry cloth.",
    category: "jewelry",
    price: 2200,
    stock: 11,
    featured: false,
  },
  {
    id: "pdemoattar",
    name: "Chandan attar, 10 ml",
    description: "Sandalwood distilled in Kannauj and bottled in Indore. Alcohol-free. A drop on cloth lasts the evening.",
    category: "fragrance",
    price: 1650,
    stock: 14,
    featured: false,
  },
  {
    id: "pdemokantha",
    name: "Block-print kantha throw",
    description: "Cotton throw with running kantha stitch and a faded indigo print. 150 by 220 cm.",
    category: "home",
    price: 3200,
    stock: 5,
    featured: false,
  },
  {
    id: "pdemobelt",
    name: "Vegetable-tanned belt",
    description: "Thirty-millimetre strap with a plain brass buckle. Cut from a single hide. Choose your hole; it will mark with wear.",
    category: "leather",
    price: 1450,
    stock: 8,
    featured: false,
  },
  {
    id: "pdemocups",
    name: "Narmada clay cup, set of two",
    description: "Unglazed sipping cups. The clay keeps water cool. Not for the dishwasher.",
    category: "tableware",
    price: 780,
    stock: 0,
    featured: false,
  },
];

/** A scripted line. `card` lines become server-sent custom messages built from the order record. */
export type ScriptLine = { from: DemoParty | "system"; text: string; card?: "offer" | "track" };

type OrderSeed = {
  key: string;
  productId: string;
  quantity: number;
  status: OrderStatus;
  /** Minutes before "now" the order was placed. */
  placedAgo: number;
  shipment?: { courier: string; awb: string; eta: string };
  offer?: { amount: number; note: string };
  script: ScriptLine[];
  support?: {
    status: RequestStatus;
    note: string;
    claimed: boolean;
    resolution?: Resolution;
    resolutionNote?: string;
  };
};

/**
 * Showcase story: a Hindi-reading buyer (Asha) and an English-writing seller (Meera).
 * 1. Sari — delivered with a frayed border; buyer escalated; case waits in the support
 *    queue so an agent can claim it and read the pre-join history.
 * 2. Jhumkas — shipped, friendly conversation in two languages.
 * 3. Kantha throw — an earlier issue already resolved with a replacement.
 */
export const DEMO_ORDERS: OrderSeed[] = [
  {
    key: "sari",
    productId: "pdemosari",
    quantity: 1,
    status: "delivered",
    placedAgo: 60 * 26,
    script: [
      { from: "system", text: "Update · Order conversation opened for Maheshwari cotton sari." },
      { from: "buyer", text: "नमस्ते मीरा जी! क्या यह साड़ी शनिवार तक पहुँच जाएगी? मुझे शादी में पहननी है।" },
      { from: "seller", text: "Namaste Asha! Yes, I will pack it today and it should reach you by Friday." },
      { from: "system", text: "Update · Packed by Meera Joshi." },
      { from: "system", text: "Update · Shipped. On its way to the buyer." },
      { from: "system", text: "Update · Delivered." },
      { from: "buyer", text: "साड़ी मिल गई, धन्यवाद। लेकिन किनारे की ज़री एक जगह से उधड़ी हुई है।" },
      { from: "seller", text: "I'm so sorry about that. Could you tell me where exactly? I can offer a 10% refund." },
      { from: "buyer", text: "मुझे पैसे वापस नहीं चाहिए, साड़ी बदलनी है। शादी शनिवार को है।" },
      { from: "system", text: "Update · Support requested for this order." },
    ],
    support: {
      status: "requested",
      note: "किनारे की ज़री उधड़ी हुई है। शनिवार की शादी से पहले साड़ी बदलनी है।",
      claimed: false,
    },
  },
  {
    key: "jhumkas",
    productId: "pdemojhumka",
    quantity: 1,
    status: "shipped",
    placedAgo: 60 * 5,
    script: [
      { from: "system", text: "Update · Order conversation opened for Hammered brass jhumkas." },
      { from: "buyer", text: "क्या इन झुमकों के साथ कोई डिब्बा भी आता है? ये तोहफ़ा है।" },
      { from: "seller", text: "Yes! They come in a cotton pouch inside a small box. I can add a handwritten note too." },
      { from: "buyer", text: "बहुत अच्छा। नोट पर लिख दीजिए: 'प्यारी दीदी के लिए'।" },
      { from: "seller", text: "Done — the note is in. Shipping today." },
      { from: "system", text: "Update · Packed by Meera Joshi." },
      { from: "system", text: "Update · Shipped. On its way to the buyer." },
      { from: "seller", text: "", card: "track" },
    ],
    shipment: { courier: "Delhivery", awb: "3829 1104 552", eta: "Mon, 9 Nov" },
  },
  {
    key: "attar",
    productId: "pdemoattar",
    quantity: 1,
    status: "placed",
    placedAgo: 45,
    script: [
      { from: "system", text: "Update · Order conversation opened for Chandan attar, 10 ml." },
      { from: "buyer", text: "दीवाली के लिए दो और मंगवाने हैं। क्या कुछ छूट मिल सकती है?" },
      { from: "seller", text: "Happy Diwali! I can offer a festive price on this order, with free shipping." },
      { from: "seller", text: "", card: "offer" },
    ],
    offer: { amount: 1490, note: "Festive price · free shipping" },
  },
  {
    key: "kantha",
    productId: "pdemokantha",
    quantity: 1,
    status: "delivered",
    placedAgo: 60 * 24 * 9,
    script: [
      { from: "system", text: "Update · Order conversation opened for Block-print kantha throw." },
      { from: "system", text: "Update · Delivered." },
      { from: "buyer", text: "यह चादर नीली है, मैंने हरी वाली मंगवाई थी।" },
      { from: "seller", text: "Oh no, that's my mistake. Let me check with support so we can fix it quickly." },
      { from: "system", text: "Update · Support requested for this order." },
      { from: "system", text: "Update · Support joined. Kabir Shah is on this order with the buyer and seller." },
      { from: "support", text: "Hi Asha, hi Meera. Since the wrong colour was sent, I propose a free replacement in green." },
      { from: "system", text: "Update · Resolution proposed: Replacement. Green throw ships free; keep the blue one until pickup." },
      { from: "seller", text: "Agreed. The green throw ships tomorrow." },
      { from: "system", text: "Update · Resolved. The buyer confirmed the resolution." },
      { from: "buyer", text: "धन्यवाद कबीर जी और मीरा जी!" },
    ],
    support: {
      status: "completed",
      note: "गलत रंग की चादर आई।",
      claimed: true,
      resolution: "replacement",
      resolutionNote: "Green throw ships free; keep the blue one until pickup.",
    },
  },
];

export function demoId(prefix: string): string {
  return `${prefix}${randomBytes(6).toString("hex")}`;
}

export function demoProductRecords(sellerId: string, now: string): ProductRecord[] {
  const origin = Date.parse(now);
  return DEMO_PRODUCTS.map((seed, index) => {
    const createdAt = new Date(origin - (DEMO_PRODUCTS.length - index) * 36e5 * 24).toISOString();
    return {
      id: seed.id,
      sellerId,
      name: seed.name,
      description: seed.description,
      category: seed.category,
      price: seed.price,
      stock: seed.stock,
      published: true,
      featured: seed.featured,
      sample: true,
      images: imagesForProductName(seed.name) ?? [PRODUCT_IMAGES[0].src],
      createdAt,
      updatedAt: createdAt,
    };
  });
}

export type DemoUserIds = Record<DemoParty, string>;

export type DemoOrderPlan = {
  order: OrderRecord;
  request: RequestRecord | null;
  script: ScriptLine[];
  supportInChannel: boolean;
};

export type DemoPlan = {
  products: ProductRecord[];
  orders: DemoOrderPlan[];
};

/** Build the showcase orders for the given demo user ids. Channel ids are filled in by the caller. */
export function buildDemoPlan(users: DemoUserIds, now = new Date().toISOString()): DemoPlan {
  const products = demoProductRecords(users.seller, now);
  const byId = new Map(products.map((product) => [product.id, product]));
  const origin = Date.parse(now);
  const orders = DEMO_ORDERS.map((seed): DemoOrderPlan => {
    const product = byId.get(seed.productId)!;
    const id = demoId("o");
    const createdAt = new Date(origin - seed.placedAgo * 60_000).toISOString();
    const updatedAt = new Date(origin - Math.floor(seed.placedAgo / 3) * 60_000).toISOString();
    const order: OrderRecord = {
      id,
      buyerId: users.buyer,
      sellerId: users.seller,
      status: seed.status,
      payment: "simulated",
      items: [
        {
          productId: product.id,
          sellerId: users.seller,
          name: product.name,
          image: product.images[0] ?? "",
          quantity: seed.quantity,
          price: product.price,
        },
      ],
      total: product.price * seed.quantity,
      channelId: null,
      createdAt,
      updatedAt,
      originalTotal: seed.offer ? product.price * seed.quantity : null,
      offer: seed.offer ? { id: demoId("f"), amount: seed.offer.amount, note: seed.offer.note, state: "open" } : null,
      shipment: seed.shipment ?? null,
    };
    const request: RequestRecord | null = seed.support
      ? {
          id: demoId("r"),
          kind: "companion",
          note: seed.support.note,
          status: seed.support.status,
          memberId: users.buyer,
          volunteerId: users.seller,
          coordinatorId: seed.support.claimed ? users.support : null,
          channelId: null,
          orderId: id,
          resolution: seed.support.resolution ?? null,
          resolutionNote: seed.support.resolutionNote ?? null,
          resolvedAt: seed.support.status === "completed" ? updatedAt : null,
          createdAt: updatedAt,
          updatedAt,
        }
      : null;
    return { order, request, script: seed.script, supportInChannel: Boolean(seed.support?.claimed) };
  });
  return { products, orders };
}

/** Assign `order{orderId}` channel ids (the app-wide convention) to a plan. */
export function attachChannels(plan: DemoPlan, channelFor: (orderId: string) => string): DemoPlan {
  for (const entry of plan.orders) {
    entry.order.channelId = channelFor(entry.order.id);
    if (entry.request) entry.request.channelId = entry.order.channelId;
  }
  return plan;
}
