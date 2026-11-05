import type { Category } from "./types";

export const CATEGORY_LABEL: Record<Category, string> = {
  textile: "Textile",
  home: "Home",
  jewelry: "Jewelry",
  leather: "Leather",
  fragrance: "Fragrance",
  tableware: "Tableware",
};

export const CATALOG_SORTS = ["relevance", "price-asc", "price-desc", "newest"] as const;
export type CatalogSort = (typeof CATALOG_SORTS)[number];

export type ProductImageAsset = {
  src: string;
  alt: string;
  objectPosition: string;
  fit: "cover" | "contain";
  label: string;
  source: string;
  license: string;
};

export type ProductImagePack = {
  key: string;
  names: string[];
  images: ProductImageAsset[];
};

const USER_REF = "User-supplied product photograph for this ShopBridge catalogue.";
const USER_LICENSE = "Project reference photograph. Stored locally; not hotlinked.";
const PEXELS = "Pexels License — free to use, including commercially. https://www.pexels.com/license/";

export const PRODUCT_IMAGE_PACKS: ProductImagePack[] = [
  {
    key: "maheshwari-cotton-sari",
    names: ["Maheshwari cotton sari"],
    images: [
      {
        src: "/products/sari.webp",
        alt: "Woman wearing a mustard Maheshwari cotton sari with a pink geometric border",
        objectPosition: "50% 18%",
        fit: "cover",
        label: "Maheshwari sari",
        source: USER_REF,
        license: USER_LICENSE,
      },
    ],
  },
  {
    key: "cane-and-hide-tote",
    names: ["Cane and hide tote"],
    images: [
      {
        src: "/products/tote.webp",
        alt: "Square cane tote with vegetable-tanned hide trim and handles on a plaster ledge",
        objectPosition: "58% 48%",
        fit: "cover",
        label: "Cane tote",
        source: USER_REF,
        license: USER_LICENSE,
      },
    ],
  },
  {
    key: "block-print-kantha-throw",
    names: ["Block-print kantha throw"],
    images: [
      {
        src: "/products/throw.webp",
        alt: "Indigo block-print kantha throw draped over a wooden chair, reverse showing running stitch",
        objectPosition: "50% 42%",
        fit: "cover",
        label: "Kantha throw",
        source: USER_REF,
        license: USER_LICENSE,
      },
    ],
  },
  {
    key: "hammered-brass-jhumkas",
    names: ["Hammered brass jhumkas"],
    images: [
      {
        src: "/products/jhumkas.webp",
        alt: "Pair of ornate hammered brass jhumka earrings with floral discs and hanging bells",
        objectPosition: "50% 52%",
        fit: "cover",
        label: "Brass jhumkas",
        source: USER_REF,
        license: USER_LICENSE,
      },
    ],
  },
  {
    key: "stoneware-serving-bowl",
    names: ["Stoneware serving bowl", "Pots", "Potsaa", "Handcrafted Pot"],
    images: [
      {
        src: "/products/bowl.webp",
        alt: "Stack of sand-coloured handmade stoneware serving bowls on a wooden table",
        objectPosition: "42% 78%",
        fit: "cover",
        label: "Stoneware bowl",
        source: "Pexels, photographer Lies. https://www.pexels.com/photo/stacked-handmade-ceramic-bowls-and-plates-32296615/",
        license: PEXELS,
      },
      {
        src: "/products/bowl-detail.webp",
        alt: "Close view of a hand-formed clay bowl showing its sand-coloured surface",
        objectPosition: "50% 50%",
        fit: "cover",
        label: "Bowl texture",
        source: "Pexels, photographer Yan Krukau. https://www.pexels.com/photo/close-up-of-a-clay-bowl-with-rough-texture-6611470/",
        license: PEXELS,
      },
    ],
  },
  {
    key: "chandan-attar",
    names: ["Chandan attar, 10 ml"],
    images: [
      {
        src: "/products/attar.webp",
        alt: "Small amber glass attar bottle with a dropper standing on linen",
        objectPosition: "50% 58%",
        fit: "cover",
        label: "Attar bottle",
        source: "Pexels, photographer Alesia Kozik. https://www.pexels.com/photo/amber-dropper-on-brown-textile-7795849/",
        license: PEXELS,
      },
      {
        src: "/products/attar-drop.webp",
        alt: "A drop of sandalwood-coloured oil falling from a dropper into an amber bottle",
        objectPosition: "50% 40%",
        fit: "cover",
        label: "Attar drop",
        source: "Pexels, Kaboompics. https://www.pexels.com/photo/dropper-with-brown-liquid-4084631/",
        license: PEXELS,
      },
    ],
  },
  {
    key: "vegetable-tanned-belt",
    names: ["Vegetable-tanned belt"],
    images: [
      {
        src: "/products/belt.webp",
        alt: "Brown vegetable-tanned leather belt with a plain brass buckle",
        objectPosition: "32% 48%",
        fit: "cover",
        label: "Leather belt",
        source: "Pexels, photographer BELTLEY COM. https://www.pexels.com/photo/high-quality-leather-belt-with-brass-buckle-35392687/",
        license: PEXELS,
      },
      {
        src: "/products/belt-detail.webp",
        alt: "Hands fitting a plain brass buckle onto a vegetable-tanned leather strap",
        objectPosition: "50% 42%",
        fit: "cover",
        label: "Belt buckle",
        source: "Pexels, photographer cottonbro studio. https://www.pexels.com/photo/a-person-holding-the-buckle-of-a-brown-leather-belt-6654751/",
        license: PEXELS,
      },
    ],
  },
  {
    key: "narmada-clay-cup",
    names: ["Narmada clay cup, set of two"],
    images: [
      {
        src: "/products/cups.webp",
        alt: "Two unglazed terracotta sipping cups with chai, ginger and cardamom",
        objectPosition: "48% 38%",
        fit: "cover",
        label: "Clay cups",
        source: "Pexels, photographer Sanket Sawale. https://www.pexels.com/photo/tea-and-ginger-roots-20270270/",
        license: PEXELS,
      },
      {
        src: "/products/cups-use.webp",
        alt: "Unglazed clay kulhads of chai being passed on a terracotta tray",
        objectPosition: "50% 50%",
        fit: "cover",
        label: "Clay cups in use",
        source: "Pexels, photographer Sagar Mali. https://www.pexels.com/photo/traditional-clay-cup-masala-chai-street-vendor-36662612/",
        license: PEXELS,
      },
    ],
  },
  {
    key: "copper-diya",
    names: ["Test copper diya"],
    images: [
      {
        src: "/products/diya.webp",
        alt: "Small brass and copper oil diya on a metal plate with jasmine nearby",
        objectPosition: "55% 52%",
        fit: "cover",
        label: "Copper diya",
        source: "Pexels, photographer Praveen PA. https://www.pexels.com/photo/close-up-shot-of-brass-oil-lamp-5027991/",
        license: PEXELS,
      },
    ],
  },
];

const seen = new Set<string>();
export const PRODUCT_IMAGES: ProductImageAsset[] = PRODUCT_IMAGE_PACKS.flatMap((pack) => pack.images).filter((asset) => {
  if (seen.has(asset.src)) return false;
  seen.add(asset.src);
  return true;
});

const ASSET_BY_SRC = new Map(PRODUCT_IMAGES.map((asset) => [asset.src, asset]));
const PACK_BY_NAME = new Map(
  PRODUCT_IMAGE_PACKS.flatMap((pack) => pack.names.map((name) => [name.toLowerCase(), pack] as const)),
);

export const LOCAL_IMAGE_PATH = /^\/products\/[a-z0-9]+(?:-[a-z0-9]+)*\.(?:webp|jpg|jpeg|png|avif)$/;

export function formatInr(amount: number): string {
  return `₹${amount.toLocaleString("en-IN")}`;
}

export function categoryLabel(category: Category): string {
  return CATEGORY_LABEL[category];
}

export function imagesForProductName(name: string): string[] | null {
  const pack = PACK_BY_NAME.get(name.trim().toLowerCase());
  return pack ? pack.images.map((asset) => asset.src) : null;
}

export function assetForSrc(src: string | undefined): ProductImageAsset | undefined {
  if (!src) return undefined;
  return ASSET_BY_SRC.get(src);
}

export function isAllowedProductImage(src: string): boolean {
  return ASSET_BY_SRC.has(src) || LOCAL_IMAGE_PATH.test(src);
}

export function imageAlt(src: string | undefined, fallback: string): string {
  return assetForSrc(src)?.alt || fallback;
}

export function needsLocalImageRemap(images: string[]): boolean {
  return images.length === 0 || images.some((src) => !src.startsWith("/products/"));
}
