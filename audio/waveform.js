export class WaveformPeaks {
	constructor(channels, sampleRate) {
		this.channels = channels;
		this.sampleRate = sampleRate;
		this.length = channels[0]?.length || 0;
		this.duration = this.length / sampleRate;
		this.levels = [];
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
		if (!this.length) return;
		const baseBucketSize = 64;
		let bucketSize = baseBucketSize;
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
			let minimum = 1;
			let maximum = -1;
			const beginning = bucket * bucketSize;
			const end = Math.min(beginning + bucketSize, this.length);
			for (let sample = beginning; sample < end; sample += 1) {
				let value = 0;
				for (const channel of this.channels) value += channel[sample] || 0;
				value /= Math.max(1, this.channels.length);
				if (value < minimum) minimum = value;
				if (value > maximum) maximum = value;
			}
			min[bucket] = minimum;
			max[bucket] = maximum;
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

	getColumns(startSeconds, endSeconds, width) {
		const columns = Math.max(1, Math.floor(width));
		const result = new Array(columns);
		if (!this.length || endSeconds <= startSeconds) {
			return result.fill({ min: 0, max: 0 });
		}
		const startSample = startSeconds * this.sampleRate;
		const samplesPerPixel = (endSeconds - startSeconds) * this.sampleRate / columns;
		if (samplesPerPixel < 32) {
			for (let x = 0; x < columns; x += 1) {
				const from = Math.max(0, Math.floor(startSample + x * samplesPerPixel));
				const to = Math.min(this.length, Math.max(from + 1, Math.ceil(startSample + (x + 1) * samplesPerPixel)));
				let minimum = 1;
				let maximum = -1;
				for (let sample = from; sample < to; sample += 1) {
					let value = 0;
					for (const channel of this.channels) value += channel[sample] || 0;
					value /= Math.max(1, this.channels.length);
					minimum = Math.min(minimum, value);
					maximum = Math.max(maximum, value);
				}
				result[x] = from >= this.length ? { min: 0, max: 0 } : { min: minimum, max: maximum };
			}
			return result;
		}

		let level = this.levels[0];
		for (const candidate of this.levels) {
			if (candidate.bucketSize <= samplesPerPixel * 1.5) level = candidate;
			else break;
		}
		for (let x = 0; x < columns; x += 1) {
			const from = Math.max(0, Math.floor((startSample + x * samplesPerPixel) / level.bucketSize));
			const to = Math.min(level.min.length, Math.max(from + 1,
				Math.ceil((startSample + (x + 1) * samplesPerPixel) / level.bucketSize)));
			let minimum = 1;
			let maximum = -1;
			for (let bucket = from; bucket < to; bucket += 1) {
				minimum = Math.min(minimum, level.min[bucket]);
				maximum = Math.max(maximum, level.max[bucket]);
			}
			result[x] = from >= level.min.length ? { min: 0, max: 0 } : { min: minimum, max: maximum };
		}
		return result;
	}
}
