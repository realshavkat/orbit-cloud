import { useSyncExternalStore } from "react";
import { get } from "./api.js";

const listeners = new Set();
export const session = { me: null, config: {}, loaded: false };

const emit = () => listeners.forEach(l => l());

export async function loadMe() {
  try {
    session.me = await get("/me");
  } catch {
    session.me = null;
  }
  session.loaded = true;
  emit();
  return session.me;
}

export async function loadConfig() {
  session.config = await get("/config").catch(() => ({}));
}

export function setMe(me) {
  session.me = me;
  emit();
}

let snapshot = { me: session.me };
export function useMe() {
  return useSyncExternalStore(cb => {
    listeners.add(cb);
    return () => listeners.delete(cb);
  }, () => (snapshot.me === session.me ? snapshot : (snapshot = { me: session.me }))).me;
}
