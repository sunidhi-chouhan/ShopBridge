/**
 * Persistence facade: PostgreSQL when DATABASE_URL is set; otherwise JSON file store.
 * Production requires DATABASE_URL and never falls back to JSON.
 */
import { loadEnvFile } from "./env";
import { HttpError } from "./errors";
import { databaseUrlConfigured } from "./db/pool";
import * as jsonStore from "./store-json";
import * as pgStore from "./store-pg";

loadEnvFile();

export type PersistenceBackend = "postgres" | "json";

export function persistenceBackend(): PersistenceBackend {
  loadEnvFile();
  if (databaseUrlConfigured()) return "postgres";
  if (process.env.NODE_ENV === "production") {
    throw new HttpError(
      503,
      "DATABASE_REQUIRED",
      "DATABASE_URL is required in production. JSON file persistence is disabled.",
    );
  }
  return "json";
}

function api(): typeof jsonStore | typeof pgStore {
  return persistenceBackend() === "postgres" ? pgStore : jsonStore;
}

export type { UserRecord, RequestRecord, OrderRecord, ProductRecord } from "./store-types";
export type { RoomParticipants, ProductQuery } from "./store-json";

export const dataDirectory = (...args: Parameters<typeof jsonStore.dataDirectory>) =>
  jsonStore.dataDirectory(...args);

export function storePaths(): ReturnType<typeof jsonStore.storePaths> {
  if (persistenceBackend() === "postgres") return pgStore.storePaths();
  return jsonStore.storePaths();
}

export const reseedDemo = (...args: Parameters<typeof jsonStore.reseedDemo>) => api().reseedDemo(...args);
export const toPublicUser = (...args: Parameters<typeof jsonStore.toPublicUser>) => api().toPublicUser(...args);
export const toSessionUser = (...args: Parameters<typeof jsonStore.toSessionUser>) => api().toSessionUser(...args);
export const registerBuyer = (...args: Parameters<typeof jsonStore.registerBuyer>) => api().registerBuyer(...args);
export const signInWithPassword = (...args: Parameters<typeof jsonStore.signInWithPassword>) =>
  api().signInWithPassword(...args);
export const signInDemo = (...args: Parameters<typeof jsonStore.signInDemo>) => api().signInDemo(...args);
export const clearSession = (...args: Parameters<typeof jsonStore.clearSession>) => api().clearSession(...args);
export const userBySession = (...args: Parameters<typeof jsonStore.userBySession>) => api().userBySession(...args);
export const listVolunteers = (...args: Parameters<typeof jsonStore.listVolunteers>) => api().listVolunteers(...args);
export const listRequests = (...args: Parameters<typeof jsonStore.listRequests>) => api().listRequests(...args);
export const createRequest = (...args: Parameters<typeof jsonStore.createRequest>) => api().createRequest(...args);
export const prepareAssignment = (...args: Parameters<typeof jsonStore.prepareAssignment>) =>
  api().prepareAssignment(...args);
export const saveAssignment = (...args: Parameters<typeof jsonStore.saveAssignment>) => api().saveAssignment(...args);
export const prepareRoom = (...args: Parameters<typeof jsonStore.prepareRoom>) => api().prepareRoom(...args);
export const saveChannel = (...args: Parameters<typeof jsonStore.saveChannel>) => api().saveChannel(...args);
export const changeStatus = (...args: Parameters<typeof jsonStore.changeStatus>) => api().changeStatus(...args);
export const requestRecord = (...args: Parameters<typeof jsonStore.requestRecord>) => api().requestRecord(...args);
export const canReadRequest = (...args: Parameters<typeof jsonStore.canReadRequest>) => api().canReadRequest(...args);
export const listCatalog = (...args: Parameters<typeof jsonStore.listCatalog>) => api().listCatalog(...args);
export const getProduct = (...args: Parameters<typeof jsonStore.getProduct>) => api().getProduct(...args);
export const listSellerProducts = (...args: Parameters<typeof jsonStore.listSellerProducts>) =>
  api().listSellerProducts(...args);
export const createProduct = (...args: Parameters<typeof jsonStore.createProduct>) => api().createProduct(...args);
export const updateProduct = (...args: Parameters<typeof jsonStore.updateProduct>) => api().updateProduct(...args);
export const deleteProduct = (...args: Parameters<typeof jsonStore.deleteProduct>) => api().deleteProduct(...args);
export const getCart = (...args: Parameters<typeof jsonStore.getCart>) => api().getCart(...args);
export const setCartItem = (...args: Parameters<typeof jsonStore.setCartItem>) => api().setCartItem(...args);
export const checkout = (...args: Parameters<typeof jsonStore.checkout>) => api().checkout(...args);
export const listOrders = (...args: Parameters<typeof jsonStore.listOrders>) => api().listOrders(...args);
export const getOrder = (...args: Parameters<typeof jsonStore.getOrder>) => api().getOrder(...args);
export const saveOrderChannel = (...args: Parameters<typeof jsonStore.saveOrderChannel>) =>
  api().saveOrderChannel(...args);
export const orderParticipants = (...args: Parameters<typeof jsonStore.orderParticipants>) =>
  api().orderParticipants(...args);
export const assertOrderRoomAccess = (...args: Parameters<typeof jsonStore.assertOrderRoomAccess>) =>
  api().assertOrderRoomAccess(...args);
export const listConversations = (...args: Parameters<typeof jsonStore.listConversations>) =>
  api().listConversations(...args);
export const createOrderSupport = (...args: Parameters<typeof jsonStore.createOrderSupport>) =>
  api().createOrderSupport(...args);
export const claimOrderSupport = (...args: Parameters<typeof jsonStore.claimOrderSupport>) =>
  api().claimOrderSupport(...args);
export const setUserLanguage = (...args: Parameters<typeof jsonStore.setUserLanguage>) => api().setUserLanguage(...args);
export const advanceOrder = (...args: Parameters<typeof jsonStore.advanceOrder>) => api().advanceOrder(...args);
export const proposeResolution = (...args: Parameters<typeof jsonStore.proposeResolution>) =>
  api().proposeResolution(...args);
export const respondToResolution = (...args: Parameters<typeof jsonStore.respondToResolution>) =>
  api().respondToResolution(...args);
export const getDemoEpoch = () => api().getDemoEpoch();
export const demoUserIds = () => api().demoUserIds();
export const applyDemoReset = (...args: Parameters<typeof jsonStore.applyDemoReset>) => api().applyDemoReset(...args);
export const recordDemoResetFailure = (...args: Parameters<typeof jsonStore.recordDemoResetFailure>) =>
  api().recordDemoResetFailure(...args);
export type { DemoResetMeta } from "./store-json";
export const makeOffer = (...args: Parameters<typeof jsonStore.makeOffer>) => api().makeOffer(...args);
export const respondToOffer = (...args: Parameters<typeof jsonStore.respondToOffer>) => api().respondToOffer(...args);
