import { findByProps, findByName } from "@vendetta/metro";
import { before } from "@vendetta/patcher";
import { logger } from "@vendetta";

const UserStore = findByProps("getUser", "getUsers");
const UserFetcher = findByProps("fetchUser") || findByProps("fetchProfile");
const FluxDispatcher = findByProps("dispatch");

const pending = new Set();

async function forceResolve(id: string) {
    if (!id || pending.has(id) || UserStore.getUser(id)) return;
    pending.add(id);

    try {
        // Use fetchProfile if available, it's the strongest fetch
        if (UserFetcher?.fetchProfile) {
            await UserFetcher.fetchProfile(id);
        } else if (UserFetcher?.fetchUser) {
            await UserFetcher.fetchUser(id);
        }
    } catch (e) {
        // If internal fails, the API might be blocking us
    } finally {
        setTimeout(() => pending.delete(id), 10000);
    }
}

let patches = [];

export default {
    onLoad() {
        // 1. Try to patch the actual Mention Component
        const MentionModule = findByName("UserMention", false) || findByProps("UserMentionNode");
        if (MentionModule) {
            patches.push(before(MentionModule.default ? "default" : "UserMentionNode", MentionModule, (args) => {
                const id = args[0]?.userId || args[0]?.id;
                if (id) forceResolve(id);
            }));
        }

        // 2. BACKUP: Patch Message rendering to scan for <@ID>
        const MessageComponent = findByName("Message", false);
        if (MessageComponent) {
            patches.push(before("default", MessageComponent, (args) => {
                const content = args[0]?.message?.content;
                if (content && content.includes("<@")) {
                    const matches = content.match(/<@!?(\1234567890\d+)>/g);
                    matches?.forEach(m => {
                        const id = m.replace(/[<@!>]/g, "");
                        forceResolve(id);
                    });
                }
            }));
        }

        logger.info("[ValidUserFix] Aggressive Hook Loaded");
    },
    onUnload() {
        patches.forEach(p => p());
        pending.clear();
    }
};
