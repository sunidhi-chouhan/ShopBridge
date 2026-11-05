import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { CATEGORIES, type CartView, type Category, type OrderView, type ProductView } from "../../../shared/types";
import { CATALOG_SORTS, categoryLabel, formatInr, imageAlt, type CatalogSort } from "../../../shared/catalog";
import { checkout, getCart, getProduct, listProducts, setCartItem } from "../api";
import { BagIndicator } from "../ui/BagIndicator";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { PageTrail } from "../ui/PageTrail";
import { ProductPhoto } from "../ui/ProductPhoto";
import { PurchaseBar } from "../ui/PurchaseBar";
import { QtyStepper } from "../ui/QtyStepper";
import { SbLoader } from "../ui/SbLoader";
import { EmptyState, ErrorState, LoadingState } from "../ui/StateView";
import { useToast } from "../ui/Toast";

const FILTERS_KEY = "shopbridge.catalog";

type CatalogFilters = {
  q: string;
  category: Category | "";
  available: boolean;
  sort: CatalogSort;
};

const defaultFilters: CatalogFilters = { q: "", category: "", available: false, sort: "relevance" };

function readFilters(): CatalogFilters {
  try {
    const raw = sessionStorage.getItem(FILTERS_KEY);
    if (!raw) return defaultFilters;
    const parsed = JSON.parse(raw) as Partial<CatalogFilters>;
    const sort = CATALOG_SORTS.includes(parsed.sort as CatalogSort) ? (parsed.sort as CatalogSort) : "relevance";
    const category = parsed.category && CATEGORIES.includes(parsed.category as Category) ? parsed.category : "";
    return {
      q: typeof parsed.q === "string" ? parsed.q : "",
      category,
      available: parsed.available === true,
      sort,
    };
  } catch {
    return defaultFilters;
  }
}

type View =
  | { name: "catalog" }
  | { name: "product"; id: string }
  | { name: "bag" }
  | { name: "confirm"; orders: OrderView[] };

function countCart(cart: CartView): number {
  return cart.items.reduce((sum, item) => sum + item.quantity, 0);
}

export function ShopFlow({ onOpenOrders }: { onOpenOrders: () => void }) {
  const [view, setView] = useState<View>({ name: "catalog" });
  const [bagCount, setBagCount] = useState(0);
  const [bagBump, setBagBump] = useState(0);
  const catalogScroll = useRef(0);

  function applyCart(cart: CartView, bump = false) {
    setBagCount(countCart(cart));
    if (bump) setBagBump((current) => current + 1);
  }

  useEffect(() => {
    getCart()
      .then((result) => applyCart(result.cart))
      .catch(() => undefined);
  }, [view.name]);

  function leaveCatalog(next: View) {
    const canvas = document.querySelector(".canvas");
    if (canvas) catalogScroll.current = canvas.scrollTop;
    setView(next);
  }

  useEffect(() => {
    const canvas = document.querySelector(".canvas");
    if (!canvas) return;
    if (view.name === "catalog") {
      canvas.scrollTop = catalogScroll.current;
      return;
    }
    canvas.scrollTop = 0;
  }, [view.name]);

  const onCatalog = view.name === "catalog";

  return (
    <>
      <div hidden={!onCatalog} inert={!onCatalog}>
        <CatalogPage
          bagCount={bagCount}
          bagBump={bagBump}
          onProduct={(id) => leaveCatalog({ name: "product", id })}
          onBag={() => leaveCatalog({ name: "bag" })}
        />
      </div>
      {view.name === "product" ? (
        <ProductPage
          key={view.id}
          id={view.id}
          bagCount={bagCount}
          bagBump={bagBump}
          onBack={() => setView({ name: "catalog" })}
          onBag={() => setView({ name: "bag" })}
          onProduct={(id) => setView({ name: "product", id })}
          onCart={(cart, bump) => applyCart(cart, bump)}
        />
      ) : null}
      {view.name === "bag" ? (
        <BagPage
          onBack={() => setView({ name: "catalog" })}
          onProduct={(id) => setView({ name: "product", id })}
          onConfirm={(orders) => setView({ name: "confirm", orders })}
          onCart={(cart) => applyCart(cart)}
        />
      ) : null}
      {view.name === "confirm" ? (
        <ConfirmPage orders={view.orders} onOrders={onOpenOrders} onShop={() => setView({ name: "catalog" })} />
      ) : null}
    </>
  );
}

function CatalogPage({
  onProduct,
  onBag,
  bagCount,
  bagBump,
}: {
  onProduct: (id: string) => void;
  onBag: () => void;
  bagCount: number;
  bagBump: number;
}) {
  const [products, setProducts] = useState<ProductView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [filters, setFilters] = useState<CatalogFilters>(readFilters);
  const [applied, setApplied] = useState<CatalogFilters>(filters);
  const requestSeq = useRef(0);
  const productsRef = useRef(products);
  const canvasScroll = useRef(0);
  productsRef.current = products;
  const { q, category, available, sort } = filters;

  function rememberCanvas() {
    const canvas = document.querySelector(".canvas");
    if (canvas) canvasScroll.current = canvas.scrollTop;
  }

  function restoreCanvas() {
    const canvas = document.querySelector(".canvas");
    if (canvas) canvas.scrollTop = canvasScroll.current;
  }

  function load() {
    const seq = ++requestSeq.current;
    const hasRows = productsRef.current !== null;
    rememberCanvas();
    setRefreshing(hasRows);
    if (!hasRows) setError(null);
    return listProducts({ q, category, available, sort })
      .then((result) => {
        if (seq !== requestSeq.current) return;
        setProducts(result.products);
        setApplied({ q, category, available, sort });
        setError(null);
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            if (seq !== requestSeq.current) return;
            setRefreshing(false);
            restoreCanvas();
          });
        });
      })
      .catch((caught: unknown) => {
        if (seq !== requestSeq.current) return;
        setRefreshing(false);
        if (!hasRows) setError(caught instanceof Error ? caught.message : "Could not load the shop.");
      });
  }

  useEffect(() => {
    sessionStorage.setItem(FILTERS_KEY, JSON.stringify(filters));
  }, [filters]);

  useEffect(() => {
    void load();
  }, [q, category, available, sort]);

  const dirty = Boolean(q.trim() || category || available || sort !== "relevance");
  const filtered = Boolean(applied.q.trim() || applied.category || applied.available || applied.sort !== "relevance");
  const featured = !filtered ? (products?.find((item) => item.featured && item.stock > 0) ?? null) : null;
  const grid = useMemo(
    () => (featured ? (products?.filter((item) => item.id !== featured.id) ?? []) : (products ?? [])),
    [products, featured],
  );

  if (products === null && !error) return <LoadingState label="Opening the salon" />;
  if (error) {
    return (
      <ErrorState
        message={error}
        onRetry={() => void load()}
      />
    );
  }

  return (
    <section className="lookbook">
      <header className="lookbook-head">
        <div>
          <p className="kicker">Indore atelier</p>
          <h1 className="page-title">Pieces for the season.</h1>
        </div>
        <BagIndicator count={bagCount} bump={bagBump} onClick={onBag} />
      </header>
      <form
        className="lookbook-tools"
        onSubmit={(event) => {
          event.preventDefault();
        }}
      >
        <label className="look-search" htmlFor="floor-search">
          <span className="visually-hidden">Search products by name, description or maker</span>
          <input
            id="floor-search"
            type="search"
            value={q}
            onChange={(event) => setFilters((current) => ({ ...current, q: event.target.value }))}
            placeholder="Search the floor"
            autoComplete="off"
          />
        </label>
        <nav className="look-cats" aria-label="Categories">
          <button
            type="button"
            className={!category ? "is-on" : undefined}
            aria-pressed={!category}
            onClick={() => setFilters((current) => ({ ...current, category: "" }))}
          >
            All
          </button>
          {CATEGORIES.map((item) => (
            <button
              key={item}
              type="button"
              className={category === item ? "is-on" : undefined}
              aria-pressed={category === item}
              onClick={() => setFilters((current) => ({ ...current, category: item }))}
            >
              {categoryLabel(item)}
            </button>
          ))}
        </nav>
        <div className="look-filters">
          <label htmlFor="floor-stock">
            <input
              id="floor-stock"
              type="checkbox"
              checked={available}
              onChange={(event) => setFilters((current) => ({ ...current, available: event.target.checked }))}
            />
            In stock
          </label>
          <label htmlFor="floor-sort">
            Sort
            <select
              id="floor-sort"
              value={sort}
              onChange={(event) => setFilters((current) => ({ ...current, sort: event.target.value as CatalogSort }))}
            >
              <option value="relevance">Relevance</option>
              <option value="price-asc">Price: Low to High</option>
              <option value="price-desc">Price: High to Low</option>
              <option value="newest">Newest First</option>
            </select>
          </label>
          {dirty ? (
            <Button variant="quiet" onClick={() => setFilters(defaultFilters)}>
              Clear filters
            </Button>
          ) : null}
          <span className="look-refresh" aria-hidden={!refreshing}>
            {refreshing ? <SbLoader tone="catalogue" label="Updating the floor" /> : null}
          </span>
        </div>
      </form>
      <div className={`look-stage${refreshing ? " is-refreshing" : ""}`} aria-busy={refreshing || undefined}>
        {featured ? (
          <button type="button" className="campaign" onClick={() => onProduct(featured.id)}>
            <span className="campaign-frame">
              <ProductPhoto src={featured.images[0]} alt={imageAlt(featured.images[0], featured.name)} loading="eager" />
            </span>
            <span className="campaign-copy">
              <span className="kicker">{categoryLabel(featured.category)}</span>
              <strong>{featured.name}</strong>
              <span>
                {formatInr(featured.price)} · {featured.seller.name}
              </span>
            </span>
          </button>
        ) : null}
        {products && products.length === 0 ? (
          <EmptyState
            title="The floor is empty."
            detail="No published pieces match these filters."
            scene="shop"
            actionLabel={dirty ? "Clear filters" : undefined}
            onAction={dirty ? () => setFilters(defaultFilters) : undefined}
          />
        ) : null}
        {grid.length > 0 ? (
          <ul className="look-grid">
            {grid.map((product) => (
              <li key={product.id}>
                <ProductTile product={product} onOpen={() => onProduct(product.id)} />
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </section>
  );
}

function ProductTile({ product, onOpen }: { product: ProductView; onOpen: () => void }) {
  return (
    <button type="button" className="tile" onClick={onOpen}>
      <span className="tile-frame">
        <ProductPhoto src={product.images[0]} alt={imageAlt(product.images[0], product.name)} />
      </span>
      <span className="tile-meta">
        <strong>{product.name}</strong>
        <span className="tile-price">{formatInr(product.price)}</span>
        <span className="tile-maker">{product.seller.name}</span>
        {product.stock === 0 ? <span className="sold">Held</span> : null}
      </span>
    </button>
  );
}

function ProductPage({
  id,
  onBack,
  onBag,
  onProduct,
  onCart,
  bagCount,
  bagBump,
}: {
  id: string;
  onBack: () => void;
  onBag: () => void;
  onProduct: (id: string) => void;
  onCart: (cart: CartView, bump?: boolean) => void;
  bagCount: number;
  bagBump: number;
}) {
  const toast = useToast();
  const [product, setProduct] = useState<ProductView | null>(null);
  const [related, setRelated] = useState<ProductView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [qty, setQty] = useState(1);
  const [pending, setPending] = useState(false);
  const [added, setAdded] = useState(false);
  const [active, setActive] = useState(0);

  useEffect(() => {
    let alive = true;
    setProduct(null);
    setError(null);
    getProduct(id)
      .then((result) => {
        if (!alive) return;
        setProduct(result.product);
        setQty(result.product.stock > 0 ? 1 : 0);
        setActive(0);
        setAdded(false);
        return listProducts({ category: result.product.category }).then((list) => {
          if (alive) setRelated(list.products.filter((item) => item.id !== result.product.id).slice(0, 3));
        });
      })
      .catch((caught: unknown) => {
        if (alive) setError(caught instanceof Error ? caught.message : "Could not open this piece.");
      });
    return () => {
      alive = false;
    };
  }, [id]);

  if (!product && !error) return <LoadingState label="Opening the piece" />;
  if (error || !product) {
    return <ErrorState message={error ?? "That piece is gone."} onRetry={onBack} />;
  }

  async function add(event: FormEvent) {
    event.preventDefault();
    if (!product || pending || product.stock === 0) return;
    if (qty < 1 || qty > product.stock) {
      toast("Choose a quantity that is still on the shelf.", "error");
      return;
    }
    setPending(true);
    try {
      const result = await setCartItem(product.id, qty);
      onCart(result.cart, true);
      setAdded(true);
      toast(`${product.name} is in your bag.`);
    } catch (caught: unknown) {
      toast(caught instanceof Error ? caught.message : "Could not add that piece.", "error");
    } finally {
      setPending(false);
    }
  }

  const image = product.images[active] ?? product.images[0];

  return (
    <article className="pdp-stage">
      <header className="shop-chrome">
        <PageTrail items={[{ label: "Shop", onClick: onBack }, { label: product.name }]} />
        <BagIndicator count={bagCount} bump={bagBump} onClick={onBag} />
      </header>
      <div className="pdp">
        <div className="pdp-visual">
          <ProductPhoto src={image} alt={imageAlt(image, product.name)} loading="eager" />
          {product.images.length > 1 ? (
            <div className="pdp-thumbs">
              {product.images.map((src, index) => (
                <button
                  key={src}
                  type="button"
                  className={index === active ? "is-on" : undefined}
                  aria-label={`View photograph ${index + 1} of ${product.name}`}
                  aria-pressed={index === active}
                  onClick={() => setActive(index)}
                >
                  <ProductPhoto src={src} alt="" />
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <div className="pdp-copy">
          <p className="kicker">{categoryLabel(product.category)}</p>
          <h1 className="page-title">{product.name}</h1>
          <p className="pdp-price">{formatInr(product.price)}</p>
          <p className="lede">{product.description}</p>
          <p className="meta">
            {product.seller.name} · {product.stock > 0 ? `${product.stock} on the shelf` : "Held for now"}
            {product.stock > 0 ? ` · add up to ${product.stock}` : ""}
          </p>
          <form className="pdp-buy" onSubmit={add}>
            <PurchaseBar
              quantity={qty}
              max={product.stock}
              pending={pending}
              added={added}
              held={product.stock === 0}
              onQuantityChange={(next) => {
                setQty(next);
                setAdded(false);
              }}
              onViewBag={onBag}
            />
          </form>
        </div>
      </div>
      {related.length > 0 ? (
        <aside className="related">
          <p className="kicker">Also on the floor</p>
          <ul className="look-grid is-related">
            {related.map((item) => (
              <li key={item.id}>
                <ProductTile product={item} onOpen={() => onProduct(item.id)} />
              </li>
            ))}
          </ul>
        </aside>
      ) : null}
    </article>
  );
}

function BagPage({
  onBack,
  onProduct,
  onConfirm,
  onCart,
}: {
  onBack: () => void;
  onProduct: (id: string) => void;
  onConfirm: (orders: OrderView[]) => void;
  onCart: (cart: CartView) => void;
}) {
  const toast = useToast();
  const [cart, setCart] = useState<Awaited<ReturnType<typeof getCart>>["cart"] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function load() {
    return getCart().then((result) => setCart(result.cart));
  }

  useEffect(() => {
    load().catch((caught: unknown) => setError(caught instanceof Error ? caught.message : "Could not open your bag."));
  }, []);

  async function change(productId: string, quantity: number) {
    try {
      const result = await setCartItem(productId, quantity);
      setCart(result.cart);
      onCart(result.cart);
    } catch (caught: unknown) {
      toast(caught instanceof Error ? caught.message : "Could not update the bag.", "error");
    }
  }

  async function pay() {
    if (pending) return;
    setPending(true);
    try {
      const result = await checkout();
      onConfirm(result.orders);
    } catch (caught: unknown) {
      toast(caught instanceof Error ? caught.message : "Checkout could not finish.", "error");
    } finally {
      setPending(false);
    }
  }

  if (!cart && !error) return <LoadingState label="Opening your bag" />;
  if (error) return <ErrorState message={error} onRetry={() => void load()} />;
  if (!cart || cart.items.length === 0) {
    return (
      <section className="bag-page">
        <PageTrail items={[{ label: "Shop", onClick: onBack }, { label: "Bag" }]} />
        <header className="lookbook-head">
          <div>
            <p className="kicker">Your bag</p>
            <h1 className="page-title">Nothing to place.</h1>
          </div>
          <Button variant="secondary" onClick={onBack}>
            Back to shop
          </Button>
        </header>
        <EmptyState title="Your bag is empty." detail="Choose a piece from the floor. It will wait here until you place a simulated order." scene="shop" actionLabel="Browse the floor" onAction={onBack} />
      </section>
    );
  }

  return (
    <section className="bag-page">
      <PageTrail items={[{ label: "Shop", onClick: onBack }, { label: "Bag" }]} />
      <header className="lookbook-head">
        <div>
          <p className="kicker">Your bag</p>
          <h1 className="page-title">Review, then place.</h1>
        </div>
        <Button variant="secondary" onClick={onBack}>
          Continue browsing
        </Button>
      </header>
      <div className="bag-layout">
        <ul className="bag-list">
          {cart.items.map((item) => (
            <li key={item.product.id} className="bag-item">
              <button type="button" className="bag-thumb" onClick={() => onProduct(item.product.id)} aria-label={`Open ${item.product.name}`}>
                <ProductPhoto src={item.product.images[0]} alt={imageAlt(item.product.images[0], item.product.name)} />
              </button>
              <div className="bag-copy">
                <strong>{item.product.name}</strong>
                <p className="meta">{item.product.seller.name}</p>
                <p className="tile-price">{formatInr(item.product.price)}</p>
                <QtyStepper
                  label={`Quantity of ${item.product.name}`}
                  value={item.quantity}
                  min={0}
                  max={item.product.stock}
                  onChange={(next) => void change(item.product.id, next)}
                />
              </div>
              <div className="bag-line">
                <p className="bag-line-total">{formatInr(item.lineTotal)}</p>
                <Button variant="secondary" onClick={() => void change(item.product.id, 0)}>
                  Remove
                </Button>
              </div>
            </li>
          ))}
        </ul>
        <Card variant="compact" className="bag-sum">
          <p className="kicker">Order summary</p>
          <p className="bag-sum-line">
            Subtotal <strong>{formatInr(cart.subtotal)}</strong>
          </p>
          <p className="hint">Payment is simulated. No card is charged. A real order is still stored for this buyer and seller.</p>
          <Button pending={pending} onClick={() => void pay()}>
            Place simulated order
          </Button>
        </Card>
      </div>
    </section>
  );
}

function ConfirmPage({ orders, onOrders, onShop }: { orders: OrderView[]; onOrders: () => void; onShop: () => void }) {
  const total = orders.reduce((sum, order) => sum + order.total, 0);
  return (
    <section className="confirm-page">
      <PageTrail items={[{ label: "Shop", onClick: onShop }, { label: "Order placed" }]} />
      <Card variant="feature" className="confirm-card">
        <p className="kicker">Order placed</p>
        <h1 className="page-title">It is written in the book.</h1>
        <p className="lede">Payment was simulated. The order is stored with a unique ID for this buyer and seller.</p>
        <ul className="order-ids">
          {orders.map((order) => (
            <li key={order.id}>
              <strong>{order.id}</strong>
              <span>
                {order.seller.name} · {formatInr(order.total)}
              </span>
            </li>
          ))}
        </ul>
        <p className="bag-sum-line">
          Total <strong>{formatInr(total)}</strong>
          <span className="meta">
            {" "}
            across {orders.length} {orders.length === 1 ? "order" : "orders"}.
          </span>
        </p>
        <div className="dialog-actions">
          <Button onClick={onOrders}>View orders</Button>
          <Button variant="secondary" onClick={onShop}>
            Back to the floor
          </Button>
        </div>
      </Card>
    </section>
  );
}
