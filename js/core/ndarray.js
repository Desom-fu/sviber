// Minimal strided n-dimensional array for the scientific computing that the
// automatic timing pipeline needs. Implemented in-house on purpose: sviber must
// not pull a numerical dependency just for beat tracking.

function computeStrides(shape) {
	const strides = new Array(shape.length);
	let stride = 1;
	for (let axis = shape.length - 1; axis >= 0; axis -= 1) {
		strides[axis] = stride;
		stride *= shape[axis];
	}
	return strides;
}

function normalizeShape(shape) {
	const dimensions = Array.isArray(shape) ? shape : [shape];
	return dimensions.map(value => {
		const size = Number(value);
		if (!Number.isSafeInteger(size) || size < 0) {
			throw new RangeError(`invalid ndarray dimension: ${value}`);
		}
		return size;
	});
}

function productOf(values) {
	return values.reduce((total, value) => total * value, 1);
}

export class NDArray {
	constructor(shape, data = null, options = {}) {
		this.shape = normalizeShape(shape);
		this.strides = options.strides ? [...options.strides] : computeStrides(this.shape);
		this.offset = Number(options.offset) || 0;
		this.size = productOf(this.shape);
		const Storage = options.storage || Float64Array;
		if (data) {
			this.data = data;
		} else {
			this.data = new Storage(this.size);
		}
	}

	static zeros(shape, storage = Float64Array) {
		return new NDArray(shape, null, { storage });
	}

	static filled(shape, value, storage = Float64Array) {
		const result = NDArray.zeros(shape, storage);
		result.data.fill(value);
		return result;
	}

	static from(values, shape = null, storage = Float64Array) {
		const flat = values instanceof Float64Array || values instanceof Float32Array ? values : storage.from(values);
		const resolved = shape ? normalizeShape(shape) : [flat.length];
		if (productOf(resolved) !== flat.length) {
			throw new RangeError("ndarray data length does not match the requested shape");
		}
		return new NDArray(resolved, flat);
	}

	get rank() {
		return this.shape.length;
	}

	index(...indices) {
		let position = this.offset;
		for (let axis = 0; axis < this.shape.length; axis += 1) {
			const value = indices[axis] | 0;
			position += value * this.strides[axis];
		}
		return position;
	}

	get(...indices) {
		return this.data[this.index(...indices)];
	}

	set(...args) {
		const value = args.pop();
		this.data[this.index(...args)] = value;
		return value;
	}

	// A view over one hyperplane; used to walk the frames of a spectrogram
	// without copying the (potentially large) backing store.
	row(index) {
		if (this.rank < 2) {
			throw new RangeError("row() requires rank >= 2");
		}
		return new NDArray(this.shape.slice(1), this.data, {
			strides: this.strides.slice(1),
			offset: this.offset + index * this.strides[0],
		});
	}

	column(index) {
		if (this.rank !== 2) {
			throw new RangeError("column() requires rank 2");
		}
		return new NDArray([this.shape[0]], this.data, {
			strides: [this.strides[0]],
			offset: this.offset + index * this.strides[1],
		});
	}

	toArray() {
		const result = new Float64Array(this.size);
		if (this.isContiguous()) {
			result.set(this.data.subarray(this.offset, this.offset + this.size));
			return result;
		}
		const indices = new Array(this.rank).fill(0);
		for (let position = 0; position < this.size; position += 1) {
			result[position] = this.data[this.index(...indices)];
			for (let axis = this.rank - 1; axis >= 0; axis -= 1) {
				indices[axis] += 1;
				if (indices[axis] < this.shape[axis]) {
					break;
				}
				indices[axis] = 0;
			}
		}
		return result;
	}

	isContiguous() {
		const expected = computeStrides(this.shape);
		return this.strides.every((stride, axis) => stride === expected[axis]);
	}

	map(transform) {
		const values = this.toArray();
		for (let position = 0; position < values.length; position += 1) {
			values[position] = transform(values[position], position);
		}
		return NDArray.from(values, this.shape);
	}

	reduce(reducer, initial) {
		const values = this.toArray();
		let accumulator = initial;
		for (let position = 0; position < values.length; position += 1) {
			accumulator = reducer(accumulator, values[position], position);
		}
		return accumulator;
	}

	max() {
		return this.reduce((best, value) => (value > best ? value : best), -Infinity);
	}

	min() {
		return this.reduce((best, value) => (value < best ? value : best), Infinity);
	}

	mean() {
		return this.size ? this.reduce((total, value) => total + value, 0) / this.size : 0;
	}

	argmax() {
		let best = -Infinity;
		let bestIndex = -1;
		const values = this.toArray();
		for (let position = 0; position < values.length; position += 1) {
			if (values[position] > best) {
				best = values[position];
				bestIndex = position;
			}
		}
		return bestIndex;
	}
}

export function halfWaveRectify(value) {
	return value > 0 ? value : 0;
}

export function normalizeMaximum(values, epsilon = 1e-12) {
	let maximum = 0;
	for (let index = 0; index < values.length; index += 1) {
		const magnitude = Math.abs(values[index]);
		if (magnitude > maximum) {
			maximum = magnitude;
		}
	}
	if (maximum <= epsilon) {
		return values;
	}
	for (let index = 0; index < values.length; index += 1) {
		values[index] /= maximum;
	}
	return values;
}
