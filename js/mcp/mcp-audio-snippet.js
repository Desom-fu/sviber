// PCM WAV encoder used by the MCP music-snippet tool.

export function encodeWavPcm16(samples, sampleRate) {
	const rate = Math.max(1, Math.floor(Number(sampleRate) || 44100));
	const count = samples?.length || 0;
	const dataSize = count * 2;
	const buffer = new ArrayBuffer(44 + dataSize);
	const view = new DataView(buffer);
	const bytes = new Uint8Array(buffer);
	writeAscii(bytes, 0, "RIFF");
	view.setUint32(4, 36 + dataSize, true);
	writeAscii(bytes, 8, "WAVE");
	writeAscii(bytes, 12, "fmt ");
	view.setUint32(16, 16, true);
	view.setUint16(20, 1, true);
	view.setUint16(22, 1, true);
	view.setUint32(24, rate, true);
	view.setUint32(28, rate * 2, true);
	view.setUint16(32, 2, true);
	view.setUint16(34, 16, true);
	writeAscii(bytes, 36, "data");
	view.setUint32(40, dataSize, true);
	let offset = 44;
	for (let index = 0; index < count; index += 1) {
		const sample = Math.max(-1, Math.min(1, samples[index] || 0));
		view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
		offset += 2;
	}
	return bytes;
}

function writeAscii(bytes, offset, text) {
	for (let index = 0; index < text.length; index += 1) {
		bytes[offset + index] = text.charCodeAt(index);
	}
}
