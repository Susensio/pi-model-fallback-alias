import assert from "node:assert/strict";
import test from "node:test";
import type { Model, Provider } from "@earendil-works/pi-ai";
import { installPiModelAlias } from "../index.ts";
import { aliasRegistrySlot } from "../src/registry-slot.ts";
import { parseAliasConfig } from "../src/fallback/index.ts";
import { aliasModel } from "../src/alias/alias-model.ts";
import { ALIAS_TARGETS_ENTRY, LATENCY_REPORT_ENTRY, RESET_ENTRY } from "../src/status/transcript.ts";

test("registers aliases and handles commands through the extension API", async () => {
	const commands = new Map<string, { handler: (args?: string) => Promise<void>; getArgumentCompletions?: (prefix: string) => unknown }>();
	const listeners = new Map<string, (...args: never[]) => unknown>();
	const entries: Array<{ type: string; data: unknown }> = [];
	const target = targetModel();
	const provider = targetProvider();
	const registry = {
		find(providerId: string, modelId: string) {
			return providerId === "provider" && modelId === "target" ? target : undefined;
		},
		getProvider(providerId: string) {
			return providerId === "provider" ? provider : undefined;
		},
	};
	const pi = {
		appendEntry(type: string, data: unknown) { entries.push({ type, data }); },
		registerEntryRenderer() {},
		registerProvider() {},
		on(event: string, handler: (...args: never[]) => unknown) { listeners.set(event, handler); },
		registerCommand(name: string, command: { handler: (args?: string) => Promise<void>; getArgumentCompletions?: (prefix: string) => unknown }) { commands.set(name, command); },
	};

	installPiModelAlias(pi as never, {
		aliasConfig: parseAliasConfig({ coder: "provider/target" }),
		debugLog: { log() {} },
		cooldowns: cooldowns(),
	});

	assert.deepEqual(commands.get("model-alias-targets")?.getArgumentCompletions?.("co"), [{ value: "coder", label: "coder" }]);
	await listeners.get("session_start")?.({} as never, { model: { id: "coder", provider: "alias" }, modelRegistry: registry, hasUI: false } as never);
	await commands.get("model-alias-targets")?.handler("coder");
	await commands.get("model-alias-latency-report")?.handler("");
	await commands.get("model-alias-reset-cooldown")?.handler();

	assert.deepEqual(entries.map((entry) => entry.type), [ALIAS_TARGETS_ENTRY, LATENCY_REPORT_ENTRY, RESET_ENTRY]);
});

function doneEvent() {
	return {
		type: "done",
		reason: "stop",
		message: {
			role: "assistant",
			content: [{ type: "text", text: "target response" }],
			api: "test",
			provider: "provider",
			model: "target",
			usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
			stopReason: "stop",
			timestamp: 0,
		},
	};
}

function harness() {
	const commands = new Map<string, { handler: (args?: string) => Promise<void>; getArgumentCompletions?: (prefix: string) => unknown }>();
	const listeners = new Map<string, (...args: never[]) => unknown>();
	const providers: unknown[] = [];
	const pi = {
		appendEntry() {},
		registerEntryRenderer() {},
		registerProvider(provider: unknown) { providers.push(provider); },
		on(event: string, handler: (...args: never[]) => unknown) { listeners.set(event, handler); },
		registerCommand(name: string, command: { handler: (args?: string) => Promise<void>; getArgumentCompletions?: (prefix: string) => unknown }) { commands.set(name, command); },
	};
	return { pi, providers, listeners, commands };
}

function streamingRegistry() {
	const target = targetModel();
	return {
		find(providerId: string, modelId: string) {
			return providerId === "provider" && modelId === "target" ? target : undefined;
		},
		getProvider() {
			return {
				async *streamSimple() { yield doneEvent(); },
				async *stream() { yield doneEvent(); },
			};
		},
		async getApiKeyAndHeaders() { return { ok: true }; },
	};
}

function targetModel(): Model<"test"> {
	return {
		id: "target", name: "Target", api: "test", provider: "provider", baseUrl: "https://target.invalid",
		reasoning: false, input: ["text"], cost: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4 },
		contextWindow: 100, maxTokens: 20,
	};
}

function targetProvider(): Provider {
	return {
		id: "provider",
		name: "Provider",
		stream() { return { async *[Symbol.asyncIterator]() { yield { type: "done" }; } }; },
		streamSimple() { return { async *[Symbol.asyncIterator]() { yield { type: "done" }; } }; },
	} as unknown as Provider;
}

function cooldowns() {
	return {
		clearAll: () => 0,
		state: () => undefined,
		isActive: () => false,
		recordFailure: () => ({ failCount: 1, nextRetryAt: 0, durationMs: 0 }),
		recordSuccess() {},
		resetSuccesses() {},
	};
}

test("serves alias streams from a copy that never receives session_start", async () => {
	// A subagent whose agent definition restricts `extensions:` gets a copy of
	// this extension that is loaded but never bound, so it never sees
	// `session_start`; it still replaces the process-wide provider.
	const bound = harness();
	installPiModelAlias(bound.pi as never, {
		aliasConfig: parseAliasConfig({ coder: "provider/target" }),
		debugLog: { log() {} },
		cooldowns: cooldowns(),
	});
	await bound.listeners.get("session_start")?.({} as never, {
		model: { id: "coder", provider: "alias" },
		modelRegistry: streamingRegistry(),
		hasUI: false,
	} as never);

	const unbound = harness();
	installPiModelAlias(unbound.pi as never, {
		aliasConfig: parseAliasConfig({ coder: "provider/target" }),
		debugLog: { log() {} },
		cooldowns: cooldowns(),
	});

	const provider = unbound.providers.at(-1) as unknown as {
		streamSimple: (model: never, context: never, options: never) => AsyncIterable<{ type: string }>;
	};
	const events: Array<{ type: string }> = [];
	for await (const event of provider.streamSimple(aliasModel("coder", "alias") as never, { messages: [] } as never, {} as never)) {
		events.push(event);
	}

	assert.deepEqual(events.map((event) => event.type), ["done"]);
});

test("shares one registry slot across copies", () => {
	assert.strictEqual(aliasRegistrySlot(), aliasRegistrySlot());
});

test("keeps copies isolated when they are given their own slot", async () => {
	const first = { current: undefined };
	const second = { current: undefined };
	const registry = streamingRegistry();
	for (const slot of [first, second]) {
		const copy = harness();
		installPiModelAlias(copy.pi as never, {
			aliasConfig: parseAliasConfig({ coder: "provider/target" }),
			debugLog: { log() {} },
			cooldowns: cooldowns(),
			registrySlot: slot,
		});
		if (slot === first) {
			await copy.listeners.get("session_start")?.({} as never, {
				model: { id: "coder", provider: "alias" },
				modelRegistry: registry,
				hasUI: false,
			} as never);
		}
	}

	assert.strictEqual(first.current, registry);
	assert.strictEqual(second.current, undefined);
});
