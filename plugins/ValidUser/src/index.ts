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

const UserStore = findByProps("getUser", "getUsers");

const UserFetcher =
  findByProps("fetchUser") ??
  findByProps("getUser", "fetchProfile") ??
  null;

const FluxDispatcher =
  findByProps("dispatch", "subscribe") ??
  findByProps("_dispatch", "subscribe") ??
  null;

const MentionModule =
  findByProps("renderUserMention") ??
  findByProps("UserMentionNode") ??
  findByName("UserMentionNode", false) ??
  null;

// ---------------------------------------------------------------------------

const pendingFetches = new Set<string>();

// ---------------------------------------------------------------------------

async function resolveUser(userId: string) {
  if (!userId || pendingFetches.has(userId)) return;

  pendingFetches.add(userId);

  try {
    if (typeof UserFetcher?.fetchUser === "function") {
      await UserFetcher.fetchUser(userId);
      return;
    }

    const RestAPI =
      findByProps("getAPIBaseURL", "userGet") ??
      findByProps("userGet");

    if (typeof RestAPI?.userGet === "function") {
      const user = await RestAPI.userGet(userId);

      if (user && FluxDispatcher) {
        FluxDispatcher.dispatch({
          type: "USER_UPDATE",
          user,
        });
      }

      return;
    }

    const token = findByProps("getToken")?.getToken?.();

    if (!token) {
      logger.warn("[ValidUserFix] No auth token available — cannot fetch user", userId);
      return;
    }

    const response = await fetch(
      `https://discord.com/api/v9/users/${userId}`,
      {
        headers: { Authorization: token },
      }
    );

    if (!response.ok) {
      logger.warn(
        "[ValidUserFix] Failed to fetch user:",
        userId,
        response.status
      );
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

const patches: Array<() => void> = [];

export default {
  onLoad() {
    if (!UserStore) {
      logger.error("[ValidUserFix] UserStore not found — plugin disabled.");
      return;
    }

    if (!MentionModule) {
      logger.error("[ValidUserFix] MentionModule not found — plugin disabled.");
      return;
    }

    const methodKey = MentionModule.renderUserMention
      ? "renderUserMention"
      : "UserMentionNode";

    if (typeof (MentionModule as any)[methodKey] !== "function") {
      logger.error("[ValidUserFix] Render method not callable — plugin disabled.");
      return;
    }

    const unpatch = before(methodKey, MentionModule, (args: any[]) => {
      try {
        const ctx = args[1] ?? args[0];
        const userId = ctx?.userId ?? ctx?.id;

        if (!userId) return;
        if (UserStore.getUser(userId)) return;

        resolveUser(String(userId));
      } catch (err) {
        logger.error("[ValidUserFix] Error in before-hook:", err);
      }
    });

    patches.push(unpatch);
    logger.info("[ValidUserFix] Loaded.");
  },

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
