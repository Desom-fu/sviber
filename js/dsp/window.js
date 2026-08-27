// Window functions used by the STFT, the tempogram analysis and the PLP
// overlap-add step. FMP (2.140) defines the sampled Hann window used by default.

export const WINDOW_TYPES = Object.freeze(["hann", "hamming", "blackman", "rectangular"]);

function hann(index, length) {
	return 0.5 * (1 - Math.cos((2 * Math.PI * index) / length));
}

function hamming(index, length) {
	return 0.54 - 0.46 * Math.cos((2 * Math.PI * index) / length);
}

function blackman(index, length) {
	const phase = (2 * Math.PI * index) / length;
	return 0.42 - 0.5 * Math.cos(phase) + 0.08 * Math.cos(2 * phase);
}

export function createWindow(length, type = "hann") {
	const size = Math.max(1, Math.floor(length));
	const window = new Float64Array(size);
	for (let index = 0; index < size; index += 1) {
		if (type === "rectangular") {
			window[index] = 1;
		} else if (type === "hamming") {
			window[index] = hamming(index, size);
		} else if (type === "blackman") {
			window[index] = blackman(index, size);
		} else {
			window[index] = hann(index, size);
		}
	}
	return window;
}

// Centred window with nonzero coefficients on [-M : M], matching FMP (6.1).
export function createCenteredWindow(halfWidth, type = "hann") {
	const radius = Math.max(1, Math.floor(halfWidth));
	const length = 2 * radius + 1;
	const window = new Float64Array(length);
	const base = createWindow(length + 1, type);
	for (let index = 0; index < length; index += 1) {
		window[index] = base[index + 1];
	}
	if (type === "rectangular") {
		window.fill(1);
	}
	return window;
}

export function windowEnergy(window) {
	let total = 0;
	for (let index = 0; index < window.length; index += 1) {
		total += window[index] * window[index];
	}
	return total;
}

export function windowSum(window) {
	let total = 0;
	for (let index = 0; index < window.length; index += 1) {
		total += window[index];
	}
	return total;
}
