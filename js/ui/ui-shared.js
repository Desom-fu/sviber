let controlSequence = 0;

export function resolveElement(element, fallbackId, documentRef = globalThis.document) {
	if (typeof element === "string") {
		return documentRef?.querySelector(element) || null;
	}
	return element || (fallbackId ? documentRef?.getElementById(fallbackId) : null);
}

export function clearElement(element) {
	while (element?.firstChild) {
		element.firstChild.remove();
	}
}

export function translated(i18n, keyOrText, params, raw = false) {
	if (typeof keyOrText === "function") {
		return String(keyOrText(i18n, params) ?? "");
	}
	if (keyOrText == null) {
		return "";
	}
	return raw ? String(keyOrText) : i18n.t(String(keyOrText), params);
}

export function appendMnemonic(documentRef, element, label, mnemonic) {
	clearElement(element);
	const lowerLabel = label.toLocaleLowerCase();
	const lowerMnemonic = mnemonic.toLocaleLowerCase();
	const index = lowerLabel.indexOf(lowerMnemonic);
	if (index >= 0) {
		element.append(label.slice(0, index));
		const underline = documentRef.createElement("u");
		underline.textContent = label.slice(index, index + mnemonic.length);
		element.append(underline, label.slice(index + mnemonic.length));
		return;
	}
	element.append(`${label} (`);
	const underline = documentRef.createElement("u");
	underline.textContent = mnemonic.toUpperCase();
	element.append(underline, ")");
}

export function nextControlId(prefix) {
	return `${prefix}-${++controlSequence}`;
}
