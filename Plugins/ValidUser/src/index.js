/**
 * ValidUserFix — Revenge plugin
 *
 * Detects unresolved <@userId> mentions, fetches missing users from Discord,
 * and injects them into UserStore so mentions become clickable.
 *
 * Original Aliucord plugin by pl.js6pak — ported to Revenge/Vendetta-style.
 */

import { findByProps, findByName } from "@vendetta/metro";
import { before } from "@vendetta/patcher";
import { logger } from "@vendetta";

// ---------------------------------------------------------------------------
// Module resolution
// ---------------------------------------------------------------------------

/** Flux UserStore — exposes getUser(id) and internal user map */
const UserStore = findByProps("getUser", "getUsers");

/**
 * RESTUtils or UserFetcher — look for something that can fetch a user by ID.
 * Discord JS bundles may expose this under different names depending on version.
 */
const UserFetcher =
  findByProps("fetchUser") ??
  findByProps("getUser", "fetchProfile") ??
  null;

/**
 * FluxDispatcher — used as a fallback to dispatch USER_UPDATE if the store
 * does not expose a direct inject method.
 */
const FluxDispatcher =
  findByProps("dispatch", "subscribe") ??
  findByProps("_dispatch", "subscribe") ??
  null;

/**
 * The JS-layer equivalent of UserMentionNode.
 * Discord's React Native message renderer has a module that resolves and
 * renders @mention nodes. We look for a few known prop shapes.
 */
const MentionModule =
  findByProps("renderUserMention") ??
  findByProps("UserMentionNode") ??
  findByName("UserMentionNode", false) ??
  null;

// ---------------------------------------------------------------------------
// In-flight guard — prevents duplicate fetches for the same user ID
// ---------------------------------------------------------------------------
const pendingFetches = new Set();

// ---------------------------------------------------------------------------
// Core fetch-and-inject logic
// ---------------------------------------------------------------------------

/**
 * Attempts to fetch a user by ID and push them into UserStore so subsequent
 * mention renders resolve correctly.
 *
 * @param {string} userId
 */
async function resolveUser(userId) {
  if (!userId || pendingFetches.has(userId)) return;
  pendingFetches.add(userId);

  try {
    // Prefer an explicit fetchUser method if available
    if (typeof UserFetcher?.fetchUser === "function") {
      await UserFetcher.fetchUser(userId);
      // fetchUser typically dispatches to the store internally — we're done.
      return;
    }

    // Fallback: use the raw HTTP layer if Metro exposes it
    const RestAPI = findByProps("getAPIBaseURL", "userGet") ?? findByProps("userGet");
    if (typeof RestAPI?.userGet === "function") {
      const user = await RestAPI.userGet(userId);
      if (user && FluxDispatcher) {
        // Dispatch a USER_UPDATE action so UserStore picks it up
        FluxDispatcher.dispatch({
          type: "USER_UPDATE",
          user,
        });
      }
      return;
    }

    // Last resort: native fetch against the Discord API
    const token = findByProps("getToken")?.getToken?.();
    if (!token) {
      logger.warn("[ValidUserFix] No auth token available — cannot fetch user", userId);
      return;
    }

    const response = await fetch(`https://discord.com/api/v9/users/${userId}`, {
      headers: { Authorization: token },
    });

    if (!response.ok) {
      if (response.status === 404) {
        logger.info("[ValidUserFix] User not found (404):", userId);
      } else {
        logger.warn("[ValidUserFix] Failed to fetch user:", userId, response.status);
      }
      return;
    }

    const user = await response.json();

    if (FluxDispatcher) {
      FluxDispatcher.dispatch({ type: "USER_UPDATE", user });
    }
  } catch (err) {
    logger.error("[ValidUserFix] Error resolving user:", userId, err);
  } finally {
    pendingFetches.delete(userId);
  }
}

// ---------------------------------------------------------------------------
// Plugin lifecycle
// ---------------------------------------------------------------------------

const patches = [];

export default {
  onLoad() {
    if (!UserStore) {
      logger.error("[ValidUserFix] UserStore not found — plugin disabled.");
      return;
    }

    if (!MentionModule) {
      logger.error("[ValidUserFix] UserMentionNode module not found — plugin disabled.");
      return;
    }

    // Determine the method name to patch
    const methodKey = MentionModule.renderUserMention
      ? "renderUserMention"
      : "UserMentionNode";

    if (typeof MentionModule[methodKey] !== "function") {
      logger.error("[ValidUserFix] Render method not callable — plugin disabled.");
      return;
    }

    /**
     * Hook runs BEFORE the mention is rendered.
     * If the user is not in the store, we kick off a fetch.
     * We do NOT block rendering (no return value override needed) — the mention
     * will re-render naturally once the store emits a change.
     */
    const unpatch = before(methodKey, MentionModule, (args) => {
      try {
        // The render context is typically the second argument.
        // Shape: { userId: string, ... } — guard against unexpected shapes.
        const ctx = args[1] ?? args[0];
        const userId = ctx?.userId ?? ctx?.id;

        if (!userId) return;

        // Already resolved — nothing to do
        if (UserStore.getUser(userId)) return;

        // Kick off async fetch; do not block the render call
        resolveUser(String(userId));
      } catch (err) {
        logger.error("[ValidUserFix] Error in before-hook:", err);
      }
    });

    patches.push(unpatch);
    logger.info("[ValidUserFix] Loaded.");
  }

  onUnload() {
    for (const unpatch of patches) {
      try {
        unpatch();
      } catch (err) {
        logger.error("[ValidUserFix] Error removing patch:", err);
      }
    }
    patches.length = 0;
    pendingFetches.clear();
    logger.info("[ValidUserFix] Unloaded.");
  },
};
