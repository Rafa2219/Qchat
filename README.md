# Qchat
Un chat en linea con firmas criptograficas 

MongoDB is used for account profiles, blocked usernames, and deleted-username tombstones. Set `MONGODB_URI` (and optionally `MONGODB_DB`, which defaults to `qchat`) in `.env`. Account records are loaded into memory at server startup; profile changes are persisted when the client sends `update.profile`. The public profile contains a display name, bio, and HTTP(S) avatar URL. The optional future-use password is stored as a scrypt hash and is not currently used for sign-in.

Account deletion removes the user's account record, queued messages, and block-list references. A minimal username tombstone remains until that username is registered again, so lookups and message attempts return `user.deleted`. The deleting browser clears its local contacts, messages, identity keys, and Qchat preferences; other users' saved message copies and other devices cannot be remotely erased. Chat blocking and profile/account persistence require MongoDB.
