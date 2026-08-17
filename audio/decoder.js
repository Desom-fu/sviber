export const AUDIO_DECODE_CDN_URL = "https://cdn.jsdelivr.net/npm/audio-decode@3.12.0/+esm";

let sharedDecoderPromise = null;

function moduleDefault(module) {
	const decoder = module?.default ?? module;
	if (typeof decoder !== "function") throw new TypeError("audio-decode did not provide a decoder function.");
	return decoder;
}

export async function resolveAudioDecode(options = {}) {
	const nw = options.nw ?? globalThis.nw;
	const importModule = options.importModule ?? (url => import(url));
	if (nw) return moduleDefault(await importModule(new URL("./audio-decode.bundle.js", import.meta.url)));
	return moduleDefault(await importModule(AUDIO_DECODE_CDN_URL));
}

export function loadAudioDecode() {
	if (!sharedDecoderPromise) {
		sharedDecoderPromise = resolveAudioDecode().catch(error => {
			sharedDecoderPromise = null;
			throw error;
		});
	}
	return sharedDecoderPromise;
}

export function audioDataToBuffer(context, audioData) {
	if (audioData?.getChannelData && Number.isFinite(audioData.sampleRate)) return audioData;
	const channels = Array.isArray(audioData?.channelData) ? audioData.channelData : [];
	const sampleRate = Number(audioData?.sampleRate);
	const length = channels.reduce((maximum, channel) => Math.max(maximum, channel?.length || 0), 0);
	if (!channels.length || !length || !(sampleRate > 0)) throw new TypeError("audio-decode returned invalid audio data.");

	const buffer = context.createBuffer(channels.length, length, sampleRate);
	channels.forEach((channel, index) => {
		const samples = channel instanceof Float32Array ? channel : Float32Array.from(channel || []);
		if (typeof buffer.copyToChannel === "function") buffer.copyToChannel(samples, index);
		else buffer.getChannelData(index).set(samples);
	});
	return buffer;
}

export async function decodeAudioBytes(bytes, context, options = {}) {
	const source = bytes instanceof ArrayBuffer
		? bytes
		: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
	let decoderError;
	try {
		const decoder = options.decoder ?? await (options.loadDecoder ?? loadAudioDecode)();
		return audioDataToBuffer(context, await decoder(new Uint8Array(source)));
	} catch (error) {
		decoderError = error;
	}

	try {
		return await context.decodeAudioData(source.slice(0));
	} catch (nativeError) {
		throw new AggregateError([decoderError, nativeError], "Unable to decode the selected audio file.");
	}
}
