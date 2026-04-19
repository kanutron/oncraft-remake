/**
 * Mock SDK fixture for session-bridge tests.
 *
 * When the bridge spawns with ONCRAFT_SDK_PATH pointing here, `query()` emits
 * the captured SDK options as a `bridge:test:options_captured` event (minus the
 * non-serialisable fields `canUseTool` and `abortController`) then yields
 * nothing so the bridge loop exits cleanly.
 */

export function query({
	options,
}: {
	prompt: unknown;
	options: Record<string, unknown>;
}) {
	// Strip non-serialisable fields before emitting so JSON.stringify works.
	const { canUseTool: _cu, abortController: _ac, ...serializable } = options;
	process.stdout.write(
		`${JSON.stringify({ type: "bridge:test:options_captured", options: serializable })}\n`,
	);

	return (async function* () {
		// Yield nothing — bridge loop exits immediately.
	})();
}

export async function getSessionMessages(_sessionId: string): Promise<[]> {
	return [];
}

export async function listSubagents(_sessionId: string): Promise<[]> {
	return [];
}

export async function getSubagentMessages(
	_sessionId: string,
	_agentId: string,
): Promise<[]> {
	return [];
}
