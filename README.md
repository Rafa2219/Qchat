# Qchat
Un chat en linea con firmas criptograficas 

MongoDB is used for account profiles, blocked usernames, and deleted-username tombstones. Set `MONGODB_URI` (and optionally `MONGODB_DB`, which defaults to `qchat`) in `.env`. Account records are loaded into memory at server startup; profile changes are persisted when the client sends `update.profile`. The public profile contains a display name, bio, and HTTP(S) avatar URL, which are shown in chats. The chat menu confirms block/unblock actions and lets users unblock a previously blocked chat. The optional future-use password is stored as a scrypt hash and is not currently used for sign-in.

When a username is registered again with new encryption or signing keys, the stored public keys are replaced. Connected clients receive the new keys; other clients refresh them before sending. A centered chat card marks each detected key change. Usernames are not authenticated independently of their keys, so a username may be claimed with a new key when it is not currently online.

Account deletion removes the user's account record, queued messages, and block-list references. A minimal username tombstone remains until that username is registered again, so lookups and message attempts return `user.deleted`. The deleting browser clears its local contacts, messages, identity keys, and Qchat preferences; other users' saved message copies and other devices cannot be remotely erased. Chat blocking and profile/account persistence require MongoDB.
