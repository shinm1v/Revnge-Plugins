import { findByProps } from "@vendetta/metro";
import { after } from "@vendetta/patcher";
import { logger } from "@vendetta";

const UserStore = findByProps("getUser", "getUsers");
const UserFetcher = findByProps("fetchUser") || findByProps("fetchProfile");
const FluxDispatcher = findByProps("dispatch", "subscribe");

const pending = new Set();

async function resolve(id: string) {
    if (!id || pending.has(id) || UserStore.getUser(id)) return;
    pending.add(id);
    try {
        // fetchProfile is the strongest way to force a cache update
        if (UserFetcher?.fetchProfile) await UserFetcher.fetchProfile(id);
        else if (UserFetcher?.fetchUser) await UserFetcher.fetchUser(id);
    } catch {}
    setTimeout(() => pending.delete(id), 10000);
}

let unpatch: () => void;

export default {
    onLoad() {
        if (!FluxDispatcher) return logger.error("FluxDispatcher not found");

        // We hook the DISPATCHER. This catches messages BEFORE they even render.
        unpatch = after("dispatch", FluxDispatcher, (args) => {
            const [event] = args;

            // When a new message is received or loaded
            if (event.type === "MESSAGE_CREATE" || event.type === "LOAD_MESSAGES_SUCCESS") {
                const messages = event.type === "MESSAGE_CREATE" ? [event.message] : event.messages;
                
                messages?.forEach((msg: any) => {
                    const content = msg?.content;
                    if (typeof content === "string" && content.includes("<@")) {
                        const matches = content.match(/<@!?(\d+)>/g);
                        matches?.forEach(m => resolve(m.replace(/[<@!>]/g, "")));
                    }
                });
            }
        });

        logger.info("[ValidUserFix] Started: Monitoring Dispatcher");
    },
    onUnload() {
        unpatch?.();
        pending.clear();
    }
};
