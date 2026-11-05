import { CATEGORIES, KINDS, STATUSES, type Category, type HelpKind, type RequestStatus } from "../shared/types";
import { isAllowedProductImage } from "../shared/catalog";
import { HttpError } from "./errors";

const NAME = /^[\p{L}\p{M}][\p{L}\p{M} .'-]{1,39}$/u;

export function requireObject(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(422, "VALIDATION_ERROR", "Request body must be an object.");
  }
  return value as Record<string, unknown>;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function parseEmail(value: unknown): string {
  if (typeof value !== "string") {
    throw new HttpError(422, "VALIDATION_ERROR", "Enter your email.");
  }
  const email = value.trim().toLowerCase();
  if (email.length > 120 || !EMAIL.test(email)) {
    throw new HttpError(422, "VALIDATION_ERROR", "Enter a valid email address.");
  }
  return email;
}

export function parsePassword(value: unknown): string {
  if (typeof value !== "string") {
    throw new HttpError(422, "VALIDATION_ERROR", "Enter a password.");
  }
  if (value.length < 8 || value.length > 72) {
    throw new HttpError(422, "VALIDATION_ERROR", "Use 8–72 characters for the password.");
  }
  return value;
}

export function parseName(value: unknown): string {
  if (typeof value !== "string") {
    throw new HttpError(422, "VALIDATION_ERROR", "Enter your name.");
  }
  const name = value.trim().replace(/\s+/g, " ");
  if (!NAME.test(name)) {
    throw new HttpError(422, "VALIDATION_ERROR", "Use 2–40 letters for your name.");
  }
  return name;
}

export function parseKind(value: unknown): HelpKind {
  if (typeof value !== "string" || !KINDS.includes(value as HelpKind)) {
    throw new HttpError(422, "VALIDATION_ERROR", "Choose groceries, transport, or a companion visit.");
  }
  return value as HelpKind;
}

export function parseNote(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") {
    throw new HttpError(422, "VALIDATION_ERROR", "Note must be text.");
  }
  const note = value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim();
  if (note.length > 280) {
    throw new HttpError(422, "VALIDATION_ERROR", "Keep the note under 280 characters.");
  }
  return note;
}

export function parseStatus(value: unknown): Extract<RequestStatus, "in_progress" | "completed"> {
  if (value !== "in_progress" && value !== "completed") {
    throw new HttpError(422, "VALIDATION_ERROR", "Status can move to in progress or completed.");
  }
  return value;
}

export function parseId(value: string): string {
  if (!/^[a-z0-9]{8,40}$/.test(value)) {
    throw new HttpError(404, "NOT_FOUND", "That record does not exist.");
  }
  return value;
}

export function parseCategory(value: unknown): Category {
  if (typeof value !== "string" || !CATEGORIES.includes(value as Category)) {
    throw new HttpError(422, "VALIDATION_ERROR", "Choose a product category.");
  }
  return value as Category;
}

export function parseProductName(value: unknown): string {
  if (typeof value !== "string") {
    throw new HttpError(422, "VALIDATION_ERROR", "Enter a product name.");
  }
  const name = value.trim().replace(/\s+/g, " ");
  if (name.length < 2 || name.length > 80) {
    throw new HttpError(422, "VALIDATION_ERROR", "Use 2–80 characters for the product name.");
  }
  return name;
}

export function parseDescription(value: unknown): string {
  if (typeof value !== "string") {
    throw new HttpError(422, "VALIDATION_ERROR", "Enter a product description.");
  }
  const text = value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim();
  if (text.length < 12 || text.length > 800) {
    throw new HttpError(422, "VALIDATION_ERROR", "Keep the description between 12 and 800 characters.");
  }
  return text;
}

export function parsePrice(value: unknown): number {
  const price = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isInteger(price) || price < 1 || price > 1_000_000) {
    throw new HttpError(422, "VALIDATION_ERROR", "Price must be a whole amount between ₹1 and ₹10,00,000.");
  }
  return price;
}

export function parseStock(value: unknown): number {
  const stock = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isInteger(stock) || stock < 0 || stock > 9999) {
    throw new HttpError(422, "VALIDATION_ERROR", "Stock must be a whole number from 0 to 9999.");
  }
  return stock;
}

export function parseQuantity(value: unknown): number {
  const quantity = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isInteger(quantity) || quantity < 0 || quantity > 99) {
    throw new HttpError(422, "VALIDATION_ERROR", "Quantity must be a whole number from 0 to 99.");
  }
  return quantity;
}

export function parseImages(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 4) {
    throw new HttpError(422, "VALIDATION_ERROR", "Choose one to four product images.");
  }
  const images = value.map((item) => {
    if (typeof item !== "string") {
      throw new HttpError(422, "VALIDATION_ERROR", "Each image must be a local product photograph.");
    }
    const url = item.trim();
    if (!isAllowedProductImage(url)) {
      throw new HttpError(422, "VALIDATION_ERROR", "Choose a photograph from the studio library.");
    }
    return url;
  });
  return [...new Set(images)];
}

export function parsePublished(value: unknown): boolean {
  if (typeof value !== "boolean") {
    throw new HttpError(422, "VALIDATION_ERROR", "Published must be true or false.");
  }
  return value;
}

export function assertStatus(value: string): RequestStatus {
  if (!STATUSES.includes(value as RequestStatus)) {
    throw new HttpError(500, "STORE_ERROR", "Stored status is invalid.");
  }
  return value as RequestStatus;
}
