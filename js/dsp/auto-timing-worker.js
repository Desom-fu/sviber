// Worker wrapper for the automatic timing pipeline so that a multi-minute
// analysis never freezes the editor UI.

import { runAutoTiming } from "./auto-timing.js";

globalThis.addEventListener("message", event => {
	const request = event.data;
	if (!request || request.type !== "sviber-auto-timing") {
		return;
	}
	try {
		const samples = request.samples instanceof Float32Array ? request.samples : new Float32Array(request.samples);
		const result = runAutoTiming(samples, request.sampleRate, request.options || {});
		globalThis.postMessage({
			type: "sviber-auto-timing-result",
			id: request.id,
			timing: result.timing,
			estimatedTempo: result.estimatedTempo,
			beatCount: result.beatCount,
			keptBeatCount: result.keptBeatCount,
			algorithms: result.algorithms,
		});
	} catch (error) {
		globalThis.postMessage({
			type: "sviber-auto-timing-error",
			id: request.id,
			message: String(error?.message || error),
		});
	}
});
