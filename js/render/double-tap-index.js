function pairOrder(left, right) {
	return left.start - right.start || left.sequence - right.sequence;
}

export function refreshDoubleTapTime(index, key, createPair) {
	const oldPairs = index.doubleTapPairsByTime.get(key) || [];
	for (const pair of oldPairs) {
		index.doubleTapIndex.remove(pair);
		index.doubleTapIds.delete(pair.event1.id);
		index.doubleTapIds.delete(pair.event2.id);
		const pairIndex = index.doubleTapPairs.indexOf(pair);
		if (pairIndex >= 0) {
			index.doubleTapPairs.splice(pairIndex, 1);
		}
	}
	const taps = index.tapEventsByTime.get(key) || [];
	const nextPairs = [];
	for (let position = 0; position + 1 < taps.length; position += 1) {
		const sequence = index.eventRecordMap.get(taps[position])?.sequence ?? index.doubleTapPairs.length;
		const pair = createPair(taps[position], taps[position + 1], sequence);
		nextPairs.push(pair);
		index.doubleTapIndex.add(pair);
		index.doubleTapIds.add(pair.event1.id);
		index.doubleTapIds.add(pair.event2.id);
		let low = 0;
		let high = index.doubleTapPairs.length;
		while (low < high) {
			const middle = (low + high) >> 1;
			if (pairOrder(index.doubleTapPairs[middle], pair) <= 0) {
				low = middle + 1;
			} else {
				high = middle;
			}
		}
		index.doubleTapPairs.splice(low, 0, pair);
	}
	if (nextPairs.length) {
		index.doubleTapPairsByTime.set(key, nextPairs);
	} else {
		index.doubleTapPairsByTime.delete(key);
	}
}
