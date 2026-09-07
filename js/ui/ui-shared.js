let controlSequence = 0;

export function resolveElement(element, fallbackId, documentRef = globalThis.document) {
	if (typeof element === "string") {
		return documentRef?.querySelector(element) || null;
	}
	return element || (fallbackId ? documentRef?.getElementById(fallbackId) : null);
}

export function clearElement(element) {
	element?.replaceChildren?.();
}

// Marks a value the selected items disagree on; controls render it as a blank with a
// placeholder and report nothing until the user types something.
export const MIXED = Symbol("mixed");

// The value the selected items agree on, or MIXED when they disagree.
export function commonValue(items, getter) {
	if (!items.length) {
		return undefined;
	}
	const first = getter(items[0]);
	const serialized = JSON.stringify(first);
	return items.every(item => JSON.stringify(getter(item)) === serialized) ? first : MIXED;
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

// The expandable inline action row shared by the list panels (clips, snappees, channels): the
// row itself carries one icon button per action, and the expansion button toggles it.
export function makeInlineActionRow(documentRef, i18n, tooltip, items) {
	const row = documentRef.createElement("div");
	row.className = "item-expanded-actions";
	for (const item of items) {
		const button = documentRef.createElement("button");
		button.type = "button";
		button.className = "snappee-action";
		button.disabled = Boolean(item.disabled);
		button.setAttribute("aria-label", i18n.t(item.tooltipKey));
		const image = documentRef.createElement("img");
		image.src = `svg/icons/${item.icon}.svg`;
		image.alt = "";
		image.draggable = false;
		button.append(image);
		button.addEventListener("click", event => {
			event.stopPropagation();
			if (!button.disabled) {
				item.onSelect?.();
			}
		});
		tooltip?.register(button, item.tooltipKey);
		row.append(button);
	}
	return row;
}

export function makeExpansionButton(documentRef, i18n, tooltip, expanded, onToggle) {
	const button = documentRef.createElement("button");
	button.type = "button";
	button.className = "snappee-action item-expand-button";
	button.setAttribute("aria-expanded", String(expanded));
	button.setAttribute("aria-label", i18n.t(expanded ? "panel.item.collapse" : "panel.item.expand"));
	const image = documentRef.createElement("img");
	image.src = "svg/icons/more.svg";
	image.alt = "";
	image.draggable = false;
	button.append(image);
	button.addEventListener("click", event => {
		event.stopPropagation();
		onToggle(!expanded);
	});
	tooltip?.register(button, expanded ? "panel.item.collapse" : "panel.item.expand");
	return button;
}
