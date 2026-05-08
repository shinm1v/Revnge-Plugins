import { findByProps } from "@revenge-mod/metro";
import { before } from "@vendetta/patcher";
import { logger } from "@vendetta";

const FluxDispatcher = findByProps("dispatch", "subscribe");
const UserFetcher = findByProps("fetchProfile", "fetchUser");
const UserStore = findByProps("getUser", "getUsers");
const UserCache = findByProps("USER_CACHE"); // For direct cache access

const pending = new Set<string>();
const resolveQueue = new Map<string, number>(); // Track resolve attempts with timestamp

// Config to prevent spam
const THROTTLE_MS = 5000; // Wait 5s before retrying same user
const MAX_RETRIES = 3; // Max attempts per user per session

async function injectUserIntoCache(id: string, userData?: any) {
    try {
        // Dispatch USER_UPDATE to inject into Discord's cache
        FluxDispatcher?.dispatch?.({
            type: "USER_UPDATE",
            user: userData || { id, username: `Unknown#${id.slice(0, 4)}` }
        });

        // Also dispatch to different event types Discord might listen to
        FluxDispatcher?.dispatch?.({
            type: "USER_PROFILE_FETCH_SUCCESS",
            user: userData || { id }
        });
    } catch (e) {
        logger.error("[ValidUserFix] Cache injection failed:", e);
    }
}

async function resolveUser(id: string) {
    if (!id || pending.has(id)) return;
    
    // Check if user already cached
    if (UserStore?.getUser?.(id)) return;

    // Rate limiting: check if we've tried this user recently
    const lastAttempt = resolveQueue.get(id) || 0;
    const now = Date.now();
    
    if (now - lastAttempt < THROTTLE_MS) {
        logger.debug(`[ValidUserFix] Throttling ${id}, last attempt ${now - lastAttempt}ms ago`);
        return;
    }

    const attempts = (resolveQueue.get(`${id}_attempts`) || 0) as number;
    if (attempts >= MAX_RETRIES) {
        logger.warn(`[ValidUserFix] Max retries reached for ${id}`);
        return;
    }

    pending.add(id);
    resolveQueue.set(id, now);
    resolveQueue.set(`${id}_attempts`, attempts + 1);

    try {
        // PRIORITY 1: Use internal profile fetch (internal to Discord)
        if (typeof UserFetcher?.fetchProfile === "function") {
            logger.debug(`[ValidUserFix] Fetching profile for ${id}`);
            await UserFetcher.fetchProfile(id);
            
            // After successful fetch, check if user is now in cache
            setTimeout(() => {
                const user = UserStore?.getUser?.(id);
                if (user) {
                    injectUserIntoCache(id, user);
                    logger.debug(`[ValidUserFix] Successfully cached user ${id}`);
                }
            }, 500);
            return;
        }

        // PRIORITY 2: Use fetchUser if fetchProfile isn't available
        if (typeof UserFetcher?.fetchUser === "function") {
            logger.debug(`[ValidUserFix] Fallback to fetchUser for ${id}`);
            await UserFetcher.fetchUser(id);
            return;
        }

        // PRIORITY 3: API fallback (only if needed)
        logger.debug(`[ValidUserFix] Using API fallback for ${id}`);
        const token = findByProps("getToken")?.getToken?.();
        if (!token) {
            logger.warn("[ValidUserFix] No token available for API call");
            return;
        }

        const res = await fetch(
            `https://discord.com/api/v9/users/${id}/profile`,
            {
                headers: { Authorization: token }
            }
        );

        if (!res.ok) {
            logger.warn(`[ValidUserFix] API returned ${res.status} for user ${id}`);
            return;
        }

        const data = await res.json();
        injectUserIntoCache(id, data.user ?? data);
        
    } catch (e) {
        logger.error("[ValidUserFix] resolve failed for " + id, e);
    } finally {
        // Keep in pending set for 15s to avoid duplicate requests
        setTimeout(() => pending.delete(id), 15000);
    }
}

function extractIds(content: string) {
    const matches = content.match(/<@!?(\d+)>/g);
    return matches?.map(m => m.replace(/[<@!>]/g, "")) ?? [];
}

// Patch mention component to trigger resolve on click
function patchMentionComponent() {
    try {
        const MentionComponent = findByProps("_parseUnknownMention");
        
        if (MentionComponent?._parseUnknownMention) {
            const original = MentionComponent._parseUnknownMention;
            
            MentionComponent._parseUnknownMention = function(mention: any) {
                const result = original.call(this, mention);
                
                // If mention is unknown, try to resolve it
                if (mention?.userId) {
                    resolveUser(mention.userId);
                }
                
                return result;
            };
        }
    } catch (e) {
        logger.warn("[ValidUserFix] Failed to patch mention component:", e);
    }
}

export default {
    onLoad() {
        const Dispatcher = findByProps("dispatch", "subscribe");
        if (!Dispatcher) {
            logger.error("[ValidUserFix] Dispatcher not found");
            return;
        }

        const handler = (event: any) => {
            const msg = event?.message;
            const messages = event?.messages ?? (msg ? [msg] : []);

            for (const m of messages) {
                const content = m?.content;
                if (typeof content !== "string") continue;

                const ids = extractIds(content);
                for (const id of ids) {
                    logger.debug(`[ValidUserFix] Found mention: ${id}`);
                    resolveUser(id);
                }
            }
        };

        // Subscribe to message events
        Dispatcher.subscribe("MESSAGE_CREATE", handler);
        Dispatcher.subscribe("LOAD_MESSAGES_SUCCESS", handler);
        Dispatcher.subscribe("MESSAGE_UPDATE", handler);

        // Attempt to patch mention component for click handling
        patchMentionComponent();

        logger.info("[ValidUserFix] loaded with smart cache injection + throttling");
    },

    onUnload() {
        pending.clear();
        resolveQueue.clear();
        logger.info("[ValidUserFix] unloaded");
    }
};
