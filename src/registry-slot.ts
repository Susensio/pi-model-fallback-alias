import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export type AliasRegistry = ExtensionContext["modelRegistry"];

/**
 * The model registry the alias streams resolve their targets through.
 *
 * Pi runs more than one copy of this extension in a single process: a subagent
 * session binds extensions again, and a copy whose agent restricts
 * `extensions:` is loaded but never bound, so it never receives
 * `session_start`. Every copy re-registers the process-wide `alias` provider,
 * so the streams serving the process belong to whichever copy loaded last —
 * and that copy has no registry of its own. Sharing one slot keeps those
 * streams usable instead of failing every alias call in the process.
 */
export interface AliasRegistrySlot {
	current: AliasRegistry | undefined;
}

const SLOT_KEY = Symbol.for("pi-model-fallback-alias.registry-slot");

/** The slot shared by every copy of the extension in this process. */
export function aliasRegistrySlot(): AliasRegistrySlot {
	const store = globalThis as { [SLOT_KEY]?: AliasRegistrySlot };
	return (store[SLOT_KEY] ??= { current: undefined });
}
