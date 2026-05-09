import { findByProps, findByName } from "@metro/utils";
import { FluxDispatcher } from "@metro/common";
import { before } from "@lib/patcher";
import { Plugin } from "@lib/plugins";

const UserStore = findByProps("getUser", "getCurrentUser");
const RestAPI = findByProps("getAPIBaseURL", "get", "post") ?? findByProps("makeRequest", "get");
const UserProfileActions = findByProps("fetchProfile", "getProfileFetching");

const MENTION_RE = /<@!?(\d{17,20})>/g;
const fetched = new Set<string>();
const pending = new Set<string>();

function extractMentionedIds(content: string): string[] {
    const ids: string[] = [];
    let match: RegExpExecArray | null;
    MENTION_RE.lastIndex = 0;
    while ((match = MENTION_RE.exec(content)) !== null) {
        ids.push(match[1]);
    }
    return ids;
}

function isUserCached(id: string): boolean {
    const user = UserStore?.getUser(id);
    return !!(user && user.username);
}

const delay = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

async function resolveUser(id: string): Promise<void> {
    if (fetched.has(id) || pending.has(id)) return;
    if (isUserCached(id)) { fetched.add(id); return; }

    pending.add(id);
    try {
        if (UserProfileActions?.fetchProfile) {
            await UserProfileActions.fetchProfile(id);
        } else {
            const res = await RestAPI.get({ url: `/users/${id}` });
            if (res?.body) {
                FluxDispatcher.dispatch({ type: "USER_UPDATE", user: res.body });
            }
        }
        fetched.add(id);
    } catch (e) {
        console.warn(`[ResolveMentions] Could not fetch user ${id}:`, e);
    } finally {
        pending.delete(id);
    }
}

async function resolveUnknownMentions(ids: string[]): Promise<void> {
    const unknown = ids.filter(id => !isUserCached(id) && !fetched.has(id) && !pending.has(id));
    for (let i = 0; i < unknown.length; i++) {
        if (i > 0) await delay(150);
        resolveUser(unknown[i]);
    }
}

export default {
    patches: [] as any[],
    _unpatchers: [] as (() => void)[],

    start() {
        this._onMessage = (payload: any) => {
            try {
                const content: string = payload?.message?.content ?? "";
                const fromArray: string[] = payload?.message?.mentions?.map((u: any) => u.id) ?? [];
                const fromContent = extractMentionedIds(content);
                const allIds = [...new Set([...fromArray, ...fromContent])];
                if (allIds.length > 0) resolveUnknownMentions(allIds);
            } catch (e) {
                console.warn("[ResolveMentions] MESSAGE_CREATE handler error:", e);
            }
        };

        this._onLoadMessages = (payload: any) => {
            try {
                const messages: any[] = payload?.messages ?? [];
                const ids = new Set<string>();
                for (const msg of messages) {
                    (msg.mentions ?? []).forEach((u: any) => ids.add(u.id));
                    extractMentionedIds(msg.content ?? "").forEach(id => ids.add(id));
                }
                if (ids.size > 0) resolveUnknownMentions([...ids]);
            } catch (e) {
                console.warn("[ResolveMentions] LOAD_MESSAGES_SUCCESS handler error:", e);
            }
        };

        FluxDispatcher.subscribe("MESSAGE_CREATE", this._onMessage);
        FluxDispatcher.subscribe("LOAD_MESSAGES_SUCCESS", this._onLoadMessages);
        this._patchMentionPress();
    },

    _patchMentionPress() {
        const candidates = [
            findByName("UserMention", { default: true }),
            findByProps("handleUserMentionPress"),
            findByProps("onUserMentionPress"),
        ].filter(Boolean);

        for (const mod of candidates) {
            const target = mod.default ?? mod;
            const key = typeof target === "function" ? null
                      : (target.handleUserMentionPress ? "handleUserMentionPress"
                       : target.onUserMentionPress     ? "onUserMentionPress"
                       : null);

            if (!key && typeof target !== "function") continue;

            try {
                const unpatch = before(
                    key ?? "__call__",
                    key ? target : { __call__: target },
                    (args: any[]) => {
                        const id = typeof args[0] === "string" ? args[0]
                                 : args[0]?.userId ?? args[0]?.id;
                        if (id && !isUserCached(id)) resolveUser(id);
                    }
                );
                this._unpatchers.push(unpatch);
            } catch (e) {
                console.warn("[ResolveMentions] Could not patch mention press:", e);
            }
        }
    },

    stop() {
        FluxDispatcher.unsubscribe("MESSAGE_CREATE", this._onMessage);
        FluxDispatcher.unsubscribe("LOAD_MESSAGES_SUCCESS", this._onLoadMessages);
        this._unpatchers.forEach(u => u?.());
        this._unpatchers = [];
        fetched.clear();
        pending.clear();
    },
} satisfies Plugin;
