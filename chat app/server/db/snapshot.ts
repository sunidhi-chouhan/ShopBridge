import type { PoolClient } from "pg";
import type { Category, HelpKind, OrderStatus, RequestStatus, Role } from "../../shared/types";
import type {
  CartItemRecord,
  Database,
  OrderItemRecord,
  OrderRecord,
  ProductRecord,
  RequestRecord,
  SessionRecord,
  UserRecord,
} from "../store-types";

function iso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value;
  return new Date(String(value)).toISOString();
}

export async function loadDatabase(client: PoolClient): Promise<Database> {
  const usersRes = await client.query(
    `SELECT id, name, email, password_hash, role, sample, session_token, session_expires_at, created_at
     FROM users ORDER BY created_at ASC`,
  );
  const sessionsRes = await client.query(
    `SELECT token, user_id, expires_at FROM sessions ORDER BY expires_at ASC`,
  );
  const productsRes = await client.query(
    `SELECT id, seller_id, name, description, category, price, stock, published, featured, sample, images, created_at, updated_at
     FROM products ORDER BY created_at ASC`,
  );
  const cartsRes = await client.query(`SELECT user_id, product_id, quantity FROM cart_items`);
  const ordersRes = await client.query(
    `SELECT id, buyer_id, seller_id, status, payment, total, channel_id, created_at
     FROM orders ORDER BY created_at ASC`,
  );
  const itemsRes = await client.query(
    `SELECT order_id, product_id, seller_id, name, image, quantity, price
     FROM order_items ORDER BY id ASC`,
  );
  const requestsRes = await client.query(
    `SELECT id, kind, note, status, member_id, volunteer_id, coordinator_id, channel_id, order_id, created_at, updated_at
     FROM requests ORDER BY created_at ASC`,
  );

  const sessionsByUser = new Map<string, SessionRecord[]>();
  for (const row of sessionsRes.rows) {
    const list = sessionsByUser.get(row.user_id) ?? [];
    list.push({ token: row.token, expiresAt: iso(row.expires_at) });
    sessionsByUser.set(row.user_id, list);
  }

  const users: UserRecord[] = usersRes.rows.map((row) => {
    const sessions = sessionsByUser.get(row.id) ?? [];
    const latest = sessions[sessions.length - 1];
    return {
      id: row.id,
      name: row.name,
      email: row.email,
      passwordHash: row.password_hash,
      role: row.role as Role,
      sample: Boolean(row.sample),
      sessionToken: row.session_token ?? latest?.token ?? null,
      sessionExpiresAt: row.session_expires_at ? iso(row.session_expires_at) : latest?.expiresAt ?? null,
      sessions,
      createdAt: iso(row.created_at),
    };
  });

  const products: ProductRecord[] = productsRes.rows.map((row) => ({
    id: row.id,
    sellerId: row.seller_id,
    name: row.name,
    description: row.description,
    category: row.category as Category,
    price: Number(row.price),
    stock: Number(row.stock),
    published: Boolean(row.published),
    featured: Boolean(row.featured),
    sample: Boolean(row.sample),
    images: Array.isArray(row.images) ? row.images : JSON.parse(row.images || "[]"),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  }));

  const carts: Record<string, CartItemRecord[]> = {};
  for (const row of cartsRes.rows) {
    const list = carts[row.user_id] ?? [];
    list.push({ productId: row.product_id, quantity: Number(row.quantity) });
    carts[row.user_id] = list;
  }

  const itemsByOrder = new Map<string, OrderItemRecord[]>();
  for (const row of itemsRes.rows) {
    const list = itemsByOrder.get(row.order_id) ?? [];
    list.push({
      productId: row.product_id,
      sellerId: row.seller_id,
      name: row.name,
      image: row.image ?? "",
      quantity: Number(row.quantity),
      price: Number(row.price),
    });
    itemsByOrder.set(row.order_id, list);
  }

  const orders: OrderRecord[] = ordersRes.rows.map((row) => ({
    id: row.id,
    buyerId: row.buyer_id,
    sellerId: row.seller_id,
    status: row.status as OrderStatus,
    payment: "simulated",
    items: itemsByOrder.get(row.id) ?? [],
    total: Number(row.total),
    channelId: row.channel_id ?? null,
    createdAt: iso(row.created_at),
  }));

  const requests: RequestRecord[] = requestsRes.rows.map((row) => ({
    id: row.id,
    kind: row.kind as HelpKind,
    note: row.note,
    status: row.status as RequestStatus,
    memberId: row.member_id,
    volunteerId: row.volunteer_id ?? null,
    coordinatorId: row.coordinator_id ?? null,
    channelId: row.channel_id ?? null,
    orderId: row.order_id ?? null,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  }));

  return { users, products, orders, requests, carts };
}

export async function replaceDatabase(client: PoolClient, db: Database): Promise<void> {
  // FK-safe wipe order
  await client.query("DELETE FROM cart_items");
  await client.query("DELETE FROM order_items");
  await client.query("DELETE FROM requests");
  await client.query("DELETE FROM orders");
  await client.query("DELETE FROM products");
  await client.query("DELETE FROM sessions");
  await client.query("DELETE FROM users");

  for (const user of db.users) {
    await client.query(
      `INSERT INTO users (id, name, email, password_hash, role, sample, session_token, session_expires_at, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        user.id,
        user.name,
        user.email,
        user.passwordHash,
        user.role,
        user.sample,
        user.sessionToken,
        user.sessionExpiresAt,
        user.createdAt,
      ],
    );
    for (const session of user.sessions ?? []) {
      await client.query(`INSERT INTO sessions (token, user_id, expires_at) VALUES ($1,$2,$3)`, [
        session.token,
        user.id,
        session.expiresAt,
      ]);
    }
  }

  for (const product of db.products) {
    await client.query(
      `INSERT INTO products
       (id, seller_id, name, description, category, price, stock, published, featured, sample, images, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13)`,
      [
        product.id,
        product.sellerId,
        product.name,
        product.description,
        product.category,
        product.price,
        product.stock,
        product.published,
        product.featured,
        product.sample,
        JSON.stringify(product.images ?? []),
        product.createdAt,
        product.updatedAt,
      ],
    );
  }

  for (const [userId, items] of Object.entries(db.carts ?? {})) {
    for (const item of items) {
      await client.query(
        `INSERT INTO cart_items (user_id, product_id, quantity) VALUES ($1,$2,$3)`,
        [userId, item.productId, item.quantity],
      );
    }
  }

  for (const order of db.orders) {
    await client.query(
      `INSERT INTO orders (id, buyer_id, seller_id, status, payment, total, channel_id, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        order.id,
        order.buyerId,
        order.sellerId,
        order.status,
        order.payment,
        order.total,
        order.channelId,
        order.createdAt,
      ],
    );
    for (const item of order.items) {
      await client.query(
        `INSERT INTO order_items (order_id, product_id, seller_id, name, image, quantity, price)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [order.id, item.productId, item.sellerId, item.name, item.image, item.quantity, item.price],
      );
    }
  }

  for (const request of db.requests) {
    await client.query(
      `INSERT INTO requests
       (id, kind, note, status, member_id, volunteer_id, coordinator_id, channel_id, order_id, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        request.id,
        request.kind,
        request.note,
        request.status,
        request.memberId,
        request.volunteerId,
        request.coordinatorId,
        request.channelId,
        request.orderId,
        request.createdAt,
        request.updatedAt,
      ],
    );
  }
}

export async function countRows(client: PoolClient): Promise<{
  users: number;
  products: number;
  orders: number;
  orderItems: number;
  requests: number;
  cartItems: number;
  sessions: number;
}> {
  const tables = {
    users: "users",
    products: "products",
    orders: "orders",
    orderItems: "order_items",
    requests: "requests",
    cartItems: "cart_items",
    sessions: "sessions",
  } as const;
  const out = {} as {
    users: number;
    products: number;
    orders: number;
    orderItems: number;
    requests: number;
    cartItems: number;
    sessions: number;
  };
  for (const [key, table] of Object.entries(tables) as Array<[keyof typeof tables, string]>) {
    // table names are fixed constants above — never user input
    const res = await client.query(`SELECT COUNT(*)::int AS n FROM ${table}`);
    out[key] = Number(res.rows[0].n);
  }
  return out;
}
