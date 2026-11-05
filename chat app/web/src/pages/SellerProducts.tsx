import { useEffect, useState, type FormEvent } from "react";
import { CATEGORIES, type Category, type ProductView } from "../../../shared/types";
import { PRODUCT_IMAGES, categoryLabel, formatInr, imageAlt } from "../../../shared/catalog";
import { createProduct, deleteProduct, listSellerProducts, patchProduct } from "../api";
import { ActionMenu } from "../ui/ActionMenu";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { cardClass } from "../ui/Card";
import { productStatus } from "../ui/desk";
import { Dialog } from "../ui/Dialog";
import { Metric, MetricGrid } from "../ui/Metric";
import { PageTrail } from "../ui/PageTrail";
import { ProductPhoto } from "../ui/ProductPhoto";
import { QtyStepper } from "../ui/QtyStepper";
import { SelectField } from "../ui/SelectField";
import { EmptyState, ErrorState, LoadingState } from "../ui/StateView";
import { TextArea, TextField } from "../ui/TextField";
import { useToast } from "../ui/Toast";

type Draft = {
  name: string;
  description: string;
  category: Category;
  price: string;
  stock: number;
  images: string[];
  published: boolean;
};

function blankDraft(): Draft {
  return {
    name: "",
    description: "",
    category: "home",
    price: "",
    stock: 10,
    images: [],
    published: true,
  };
}

export function SellerProducts() {
  const toast = useToast();
  const [products, setProducts] = useState<ProductView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<ProductView | "new" | null>(null);
  const [draft, setDraft] = useState<Draft>(blankDraft);
  const [pending, setPending] = useState(false);
  const [removeId, setRemoveId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  function load() {
    return listSellerProducts().then((result) => {
      setError(null);
      setProducts(result.products);
    });
  }

  useEffect(() => {
    load().catch((caught: unknown) => setError(caught instanceof Error ? caught.message : "Could not load your shelf."));
  }, []);

  function open(product: ProductView | "new") {
    setFormError(null);
    if (product === "new") setDraft(blankDraft());
    else {
      setDraft({
        name: product.name,
        description: product.description,
        category: product.category,
        price: String(product.price),
        stock: product.stock,
        images: [...product.images],
        published: product.published,
      });
    }
    setEditing(product);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    if (!Number.isInteger(draft.stock) || draft.stock < 0 || draft.stock > 9999) {
      setFormError("Stock must be a whole number from 0 to 9999.");
      return;
    }
    if (draft.images.length === 0) {
      setFormError("Choose the photograph shoppers will see on the floor.");
      return;
    }
    setPending(true);
    setFormError(null);
    try {
      const body = {
        name: draft.name,
        description: draft.description,
        category: draft.category,
        price: Number(draft.price),
        stock: draft.stock,
        images: draft.images,
        published: draft.published,
      };
      if (editing === "new") await createProduct(body);
      else if (editing) await patchProduct(editing.id, body);
      toast("Shelf updated.");
      setEditing(null);
      await load();
    } catch (caught: unknown) {
      toast(caught instanceof Error ? caught.message : "Could not save the piece.", "error");
    } finally {
      setPending(false);
    }
  }

  async function toggle(product: ProductView) {
    try {
      await patchProduct(product.id, { published: !product.published });
      await load();
    } catch (caught: unknown) {
      toast(caught instanceof Error ? caught.message : "Could not change visibility.", "error");
    }
  }

  async function remove() {
    if (!removeId) return;
    try {
      await deleteProduct(removeId);
      setRemoveId(null);
      toast("Piece removed.");
      await load();
    } catch (caught: unknown) {
      toast(caught instanceof Error ? caught.message : "Could not delete that piece.", "error");
    }
  }

  if (!products && !error) return <LoadingState label="Opening your studio" />;
  if (error) return <ErrorState message={error} onRetry={() => void load()} />;

  if (editing) {
    return (
      <form className={cardClass("form", "studio-form")} onSubmit={save}>
        <PageTrail
          items={[
            { label: "Products", onClick: () => setEditing(null) },
            { label: editing === "new" ? "New piece" : "Edit" },
          ]}
        />
        <p className="kicker">{editing === "new" ? "New piece" : "Edit piece"}</p>
        <h1 className="page-title">{editing === "new" ? "Add to the shelf." : draft.name || "Edit"}</h1>
        <TextField id="pname" label="Name" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} required />
        <TextArea id="pdesc" label="Description" value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} required rows={5} />
        <SelectField id="pcat" label="Category" value={draft.category} onChange={(event) => setDraft({ ...draft, category: event.target.value as Category })}>
          {CATEGORIES.map((item) => (
            <option key={item} value={item}>
              {categoryLabel(item)}
            </option>
          ))}
        </SelectField>
        <TextField id="pprice" label="Price (₹)" type="number" min={1} value={draft.price} onChange={(event) => setDraft({ ...draft, price: event.target.value })} required />
        <div className="field">
          <label id="pstock-label">Stock on the shelf</label>
          <QtyStepper
            label="Stock on the shelf"
            value={draft.stock}
            min={0}
            max={9999}
            editable
            onChange={(next) => setDraft((current) => ({ ...current, stock: next }))}
          />
          <p className="hint">How many you have to sell. Shoppers can add up to this number. Default is 10 — raise it if they should be able to take more than one.</p>
        </div>
        <fieldset className="image-picker">
          <legend>Cover photograph</legend>
          <p className="hint">Choose one. Shoppers see this on the floor, the product page, and in orders.</p>
          <div className="image-grid" role="radiogroup" aria-label="Cover photograph">
            {PRODUCT_IMAGES.map((item) => {
              const selected = draft.images[0] === item.src;
              return (
                <label key={item.src} className={selected ? "is-on" : undefined}>
                  <input
                    type="radio"
                    name="product-cover"
                    value={item.src}
                    checked={selected}
                    onChange={() => setDraft((current) => ({ ...current, images: [item.src] }))}
                    required={draft.images.length === 0}
                  />
                  <ProductPhoto src={item.src} alt={item.alt} />
                  <span className="image-pick-label">{selected ? "Cover" : item.label}</span>
                </label>
              );
            })}
          </div>
        </fieldset>
        {formError ? (
          <p className="field-error" role="alert">
            {formError}
          </p>
        ) : null}
        <label className="look-filters">
          <input type="checkbox" checked={draft.published} onChange={(event) => setDraft({ ...draft, published: event.target.checked })} />
          Published on the floor
        </label>
        <div className="dialog-actions">
          <Button type="submit" pending={pending}>
            Save
          </Button>
          <Button variant="secondary" onClick={() => setEditing(null)}>
            Cancel
          </Button>
        </div>
      </form>
    );
  }

  const shelf = products ?? [];
  const live = shelf.filter((item) => item.published && item.stock > 0).length;
  const draftCount = shelf.filter((item) => !item.published).length;
  const held = shelf.filter((item) => item.published && item.stock === 0).length;

  return (
    <section className="studio desk-page">
      <header className="lookbook-head">
        <div>
          <p className="kicker">Studio</p>
          <h1 className="page-title">Your shelf.</h1>
          <p className="lede">Publish a piece to the floor, hold a draft, or remove it from bags and the shop.</p>
        </div>
        <Button onClick={() => open("new")}>New piece</Button>
      </header>
      {shelf.length > 0 ? (
        <MetricGrid>
          <Metric label="Pieces" value={String(shelf.length)} />
          <Metric label="Live" value={String(live)} />
          <Metric label="Draft" value={String(draftCount)} />
          <Metric label="Out of stock" value={String(held)} />
        </MetricGrid>
      ) : null}
      {shelf.length === 0 ? (
        <EmptyState
          compact
          title="Your shelf is empty."
          detail="Add a piece. It appears in the shop once you publish it."
          scene="products"
          actionLabel="Add a piece"
          onAction={() => open("new")}
        />
      ) : (
        <div className="studio-table-wrap">
          <table className="studio-table">
            <thead>
              <tr>
                <th>Piece</th>
                <th>Category</th>
                <th>Price</th>
                <th>Stock</th>
                <th>Status</th>
                <th> </th>
              </tr>
            </thead>
            <tbody>
              {shelf.map((product) => {
                const status = productStatus(product);
                return (
                  <tr key={product.id}>
                    <td>
                      <div className="studio-piece">
                        <ProductPhoto src={product.images[0]} alt={imageAlt(product.images[0], product.name)} />
                        <span>{product.name}</span>
                      </div>
                    </td>
                    <td>{categoryLabel(product.category)}</td>
                    <td className="cell-price">{formatInr(product.price)}</td>
                    <td>{product.stock}</td>
                    <td>
                      <Badge tone={status.tone}>{status.label}</Badge>
                    </td>
                    <td>
                      <ActionMenu label={`Actions for ${product.name}`}>
                        <Button variant="quiet" role="menuitem" onClick={() => open(product)}>
                          Edit
                        </Button>
                        <Button variant="quiet" role="menuitem" onClick={() => void toggle(product)}>
                          {product.published ? "Unpublish" : "Publish"}
                        </Button>
                        <Button variant="quiet" role="menuitem" onClick={() => setRemoveId(product.id)}>
                          Delete
                        </Button>
                      </ActionMenu>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <Dialog open={Boolean(removeId)} title="Delete this piece?" onClose={() => setRemoveId(null)}>
        <p>It will leave the shop and any bags that still hold it.</p>
        <div className="dialog-actions">
          <Button variant="secondary" onClick={() => setRemoveId(null)}>
            Keep
          </Button>
          <Button variant="danger" onClick={() => void remove()}>
            Delete
          </Button>
        </div>
      </Dialog>
    </section>
  );
}
