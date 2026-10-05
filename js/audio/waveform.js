// Min/max pyramid for the timeline waveform. The first level is 8 samples so a typical
// zoom (about 8–32 samples per pixel) reads buckets instead of scanning raw PCM every
// column. Playback still must not call this for a stationary view — that is the canvas
// cache in waveform-blit.js.

export const WAVEFORM_BASE_BUCKET = 8;

export class WaveformPeaks {
	constructor(channels, sampleRate) {
		this.channels = channels;
		this.sampleRate = sampleRate;
		this.length = channels[0]?.length || 0;
		this.duration = this.length / sampleRate;
		this.levels = [];
		this._columnResult = null;
		this._scratchPeak = { min: 0, max: 0 };
		this.#buildPyramid();
	}

	static fromAudioBuffer(buffer) {
		const channels = [];
		for (let index = 0; index < buffer.numberOfChannels; index += 1) {
			channels.push(buffer.getChannelData(index));
		}
		return new WaveformPeaks(channels, buffer.sampleRate);
	}

	#buildPyramid() {
		if (!this.length) {
			return;
		}
		let bucketSize = WAVEFORM_BASE_BUCKET;
		let previous = this.#scanSamples(bucketSize);
		this.levels.push({ bucketSize, ...previous });
		while (previous.min.length > 2048) {
			bucketSize *= 2;
			previous = this.#mergeLevel(previous);
			this.levels.push({ bucketSize, ...previous });
		}
	}

	#scanSamples(bucketSize) {
		const bucketCount = Math.ceil(this.length / bucketSize);
		const min = new Float32Array(bucketCount);
		const max = new Float32Array(bucketCount);
		for (let bucket = 0; bucket < bucketCount; bucket += 1) {
			const beginning = bucket * bucketSize;
			const end = Math.min(beginning + bucketSize, this.length);
			this.#peakBetween(beginning, end, this._scratchPeak);
			min[bucket] = this._scratchPeak.min;
			max[bucket] = this._scratchPeak.max;
		}
		return { min, max };
	}

	#mergeLevel(level) {
		const length = Math.ceil(level.min.length / 2);
		const min = new Float32Array(length);
		const max = new Float32Array(length);
		for (let index = 0; index < length; index += 1) {
			const left = index * 2;
			const right = Math.min(left + 1, level.min.length - 1);
			min[index] = Math.min(level.min[left], level.min[right]);
			max[index] = Math.max(level.max[left], level.max[right]);
		}
		return { min, max };
	}

	#columnsOut(columns) {
		if (this._columnResult?.length === columns) {
			return this._columnResult;
		}
		const result = new Array(columns);
		for (let index = 0; index < columns; index += 1) {
			result[index] = { min: 0, max: 0 };
		}
		this._columnResult = result;
		return result;
	}

	#writePeak(result, index, from, to, length, readMin, readMax) {
		if (from >= length || from >= to) {
			result[index].min = 0;
			result[index].max = 0;
			return;
		}
		let minimum = 1;
		let maximum = -1;
		for (let cursor = from; cursor < to; cursor += 1) {
			const valueMin = readMin(cursor);
			const valueMax = readMax(cursor);
			if (valueMin < minimum) {
				minimum = valueMin;
			}
			if (valueMax > maximum) {
				maximum = valueMax;
			}
		}
		result[index].min = minimum;
		result[index].max = maximum;
	}

	#peakBetween(from, to, out = { min: 0, max: 0 }) {
		if (from >= to) {
			out.min = 0;
			out.max = 0;
			return out;
		}
		const channels = this.channels;
		const count = channels.length;
		let minimum = 1;
		let maximum = -1;
		if (count === 1) {
			const data = channels[0];
			for (let sample = from; sample < to; sample += 1) {
				const value = data[sample];
				if (value < minimum) {
					minimum = value;
				}
				if (value > maximum) {
					maximum = value;
				}
			}
		} else {
			const scale = 1 / Math.max(1, count);
			for (let sample = from; sample < to; sample += 1) {
				let value = 0;
				for (let channel = 0; channel < count; channel += 1) {
					value += channels[channel][sample];
				}
				value *= scale;
				if (value < minimum) {
					minimum = value;
				}
				if (value > maximum) {
					maximum = value;
				}
			}
		}
		out.min = minimum;
		out.max = maximum;
		return out;
	}

	getColumns(startSeconds, endSeconds, width) {
		const columns = Math.max(1, Math.floor(width));
		const result = this.#columnsOut(columns);
		if (!this.length || endSeconds <= startSeconds) {
			for (let index = 0; index < columns; index += 1) {
				result[index].min = 0;
				result[index].max = 0;
			}
			return result;
		}
		const startSample = startSeconds * this.sampleRate;
		const samplesPerPixel = ((endSeconds - startSeconds) * this.sampleRate) / columns;
		if (samplesPerPixel < WAVEFORM_BASE_BUCKET) {
			this.#fillRawColumns(result, columns, startSample, samplesPerPixel);
			return result;
		}
		this.#fillPyramidColumns(result, columns, startSample, samplesPerPixel);
		return result;
	}

	#fillRawColumns(result, columns, startSample, samplesPerPixel) {
		for (let x = 0; x < columns; x += 1) {
			const from = Math.max(0, Math.floor(startSample + x * samplesPerPixel));
			const to = Math.min(
				this.length,
				Math.max(from + 1, Math.ceil(startSample + (x + 1) * samplesPerPixel)),
			);
			if (from >= this.length) {
				result[x].min = 0;
				result[x].max = 0;
				continue;
			}
			this.#peakBetween(from, to, result[x]);
		}
	}

	#fillPyramidColumns(result, columns, startSample, samplesPerPixel) {
		let level = this.levels[0];
		for (const candidate of this.levels) {
			if (candidate.bucketSize <= samplesPerPixel * 1.5) {
				level = candidate;
			} else {
				break;
			}
		}
		for (let x = 0; x < columns; x += 1) {
			const from = Math.max(0, Math.floor((startSample + x * samplesPerPixel) / level.bucketSize));
			const to = Math.min(
				level.min.length,
				Math.max(from + 1, Math.ceil((startSample + (x + 1) * samplesPerPixel) / level.bucketSize)),
			);
			this.#writePeak(
				result,
				x,
				from,
				to,
				level.min.length,
				bucket => level.min[bucket],
				bucket => level.max[bucket],
			);
		}
	}

}
