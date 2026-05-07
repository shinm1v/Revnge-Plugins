# FixInvalidMentions

FixInvalidMentions is a Revengcord plugin that improves how Discord displays broken or uncached user mentions.

It detects invalid mention formats (like raw user IDs or “unknown” mentions), tries to resolve them using cache or user fetch requests, and displays proper clickable mentions instead of broken text.

---

## ✨ Features
- Detects invalid / raw user ID mentions
- Checks local user cache first
- Fetches missing users when possible
- Improves mention display in chat
- Attempts to render proper clickable mentions

---

## 📁 Structure
ValidUser/
├── manifest.json
└── src/
    ├── index.ts
    ---

## ⚙️ How it works
The plugin intercepts mention rendering in messages:

1. Parses message content for `<@userId>` patterns  
2. Checks if user exists in cache  
3. If missing, attempts to fetch user data  
4. Updates internal store (if available)  
5. Renders proper mention component instead of raw text  

---

## 🚧 Notes
- Requires Revengcord plugin support with access to Discord internal modules
- Behavior depends on available APIs (UserStore, RestAPI, etc.)
- Some mentions may remain unresolved if user data cannot be fetched

---

## 🧠 Idea credit
Inspired by Vencord’s mention handling system.

---

## 📜 License
For educational and personal use.
