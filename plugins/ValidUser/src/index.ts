import { findByProps } from "@revenge-mod/metro";
import { before } from "@vendetta/patcher";
import { logger } from "@vendetta";

const FluxDispatcher = findByProps("dispatch", "subscribe");
const UserFetcher = findByProps("fetchProfile", "fetchUser");
const UserStore = findByProps("getUser", "getUsers");

const pending = new Set<string>();

async function resolveUser(id: string) {
    if (!id || pending.has(id)) return;
    if (UserStore?.getUser?.(id)) return;

    pending.add(id);

    try {
        // BEST CASE: use internal profile fetch (your logs confirmed this exists)
        if (typeof UserFetcher?.fetchProfile === "function") {
            await UserFetcher.fetchProfile(id);
            return;
        }

        // fallback: fetchUser if available
        if (typeof UserFetcher?.fetchUser === "function") {
            await UserFetcher.fetchUser(id);
            return;
        }

        // last fallback: API (may or may not work depending on client)
        const token = findByProps("getToken")?.getToken?.();
        if (!token) return;

        const res = await fetch(
            `https://discord.com/api/v9/users/${id}/profile`,
            {
                headers: { Authorization: token }
            }
        );

        if (!res.ok) return;

        const data = await res.json();

        FluxDispatcher?.dispatch?.({
            type: "USER_PROFILE_FETCH_SUCCESS",
            user: data.user ?? data
        });
    } catch (e) {
        logger.error("[ValidUserFix] resolve failed", e);
    } finally {
        setTimeout(() => pending.delete(id), 15000);
    }
}

function extractIds(content: string) {
    const matches = content.match(/<@!?(\d+)>/g);
    return matches?.map(m => m.replace(/[<@!>]/g, "")) ?? [];
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
                for (const id of ids) resolveUser(id);
            }
        };

        Dispatcher.subscribe("MESSAGE_CREATE", handler);
        Dispatcher.subscribe("LOAD_MESSAGES_SUCCESS", handler);

        logger.info("[ValidUserFix] running (cache resolver mode)");
    },

    onUnload() {
        pending.clear();
        logger.info("[ValidUserFix] unloaded");
    }
};
