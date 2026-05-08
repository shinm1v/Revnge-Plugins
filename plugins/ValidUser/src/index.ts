import { findByName, findByStoreName } from "@revenge-mod/metro";
import { before } from "@vendetta/patcher";
import { logger } from "@lib/utils";

const patches: (() => void)[] = [];

const RowManager = findByName("RowManager");
const UserStore = findByStoreName("UserStore");
const UserFetcher =
    findByName("fetchProfile") ||
    findByName("fetchUser");

const mentionRegex = /<@!?(\d+)>/g;

const pending = new Set<string>();

async function resolveUser(id: string) {
    if (!id || pending.has(id)) return;
    if (UserStore?.getUser?.(id)) return;

    pending.add(id);

    try {
        if (UserFetcher?.fetchProfile) {
            await UserFetcher.fetchProfile(id);
        } else if (UserFetcher?.fetchUser) {
            await UserFetcher.fetchUser(id);
        }

        logger.info(`[ValidUserFix] fetched ${id}`);
    } catch (e) {
        logger.error(`[ValidUserFix] failed ${id}`, e);
    } finally {
        setTimeout(() => pending.delete(id), 10000);
    }
}

patches.push(
    before("generate", RowManager.prototype, ([data]) => {
        try {
            if (data.rowType !== 1) return;

            const content = data?.message?.content;
            if (typeof content !== "string") return;

            const matches = content.matchAll(mentionRegex);

            for (const match of matches) {
                const id = match[1];
                resolveUser(id);
            }
        } catch (e) {
            logger.error("[ValidUserFix] generate hook failed", e);
        }
    })
);

export const onUnload = () => {
    patches.forEach(unpatch => unpatch());
};
