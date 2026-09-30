import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export type AliasRegistry = ExtensionContext["modelRegistry"];

/**
 * The bound session state every copy of this extension shares in one process.
 *
 * Pi runs more than one copy of this extension in a single process: a subagent
 * session binds extensions again, and a copy whose agent restricts
 * `extensions:` is loaded but never bound, so it never receives `session_start`.
 * Every copy re-registers the process-wide `alias` provider, so the streams
 * serving the process belong to whichever copy loaded last — and that copy has
 * neither a registry nor a UI of its own.
 *
 * Sharing one slot keeps those streams usable instead of failing every alias
 * call, and tells the serving copy that a UI exists, so it keeps failover
 * warnings off stderr, where a live TUI would draw over them.
 */
export interface AliasSessionSlot {
	registry: AliasRegistry | undefined;
	/** True once any copy in this process received a UI session. */
	hasUI: boolean;
}

const SLOT_KEY = Symbol.for("pi-model-fallback-alias.session-slot");

/** The slot shared by every copy of the extension in this process. */
export function aliasSessionSlot(): AliasSessionSlot {
	const store = globalThis as { [SLOT_KEY]?: AliasSessionSlot };
	return (store[SLOT_KEY] ??= { registry: undefined, hasUI: false });
}
