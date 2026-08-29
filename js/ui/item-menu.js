// v22: the side panels keep only the primary action of an item (activating/deactivating, or
// pasting for clips) on the item itself; every other action hides inside a small popup menu
// opened by the button this helper builds. Hitting Esc or pressing anywhere outside the menu
// closes it, and every entry closes it too — except the ones marked keepOpen (moving an item
// up or down), so a list can be reordered without reopening the menu each time.

function makeMenuEntry(document, i18n, tooltip, item, close) {
	const entry = document.createElement("button");
	entry.type = "button";
	entry.className = "item-menu-entry";
	entry.disabled = Boolean(item.disabled);
	entry.setAttribute("role", "menuitem");
	const icon = document.createElement("img");
	icon.src = `svg/icons/${item.icon}.svg`;
	icon.alt = "";
	icon.draggable = false;
	const label = document.createElement("span");
	label.textContent = i18n.t(item.tooltipKey);
	entry.append(icon, label);
	tooltip?.register(entry, item.tooltipKey);
	entry.addEventListener("click", event => {
		event.stopPropagation();
		if (entry.disabled) {
			return;
		}
		if (!item.keepOpen) {
			close();
		}
		item.onSelect?.();
	});
	return entry;
}

export function makeItemMenuButton({
	documentRef = globalThis.document,
	i18n,
	tooltip = null,
	tooltipKey,
	items,
} = {}) {
	const document = documentRef;
	const button = document.createElement("button");
	button.type = "button";
	button.className = "snappee-action item-menu-button";
	button.setAttribute("aria-haspopup", "true");
	button.setAttribute("aria-expanded", "false");
	button.setAttribute("aria-label", i18n.t(tooltipKey));
	const image = document.createElement("img");
	image.src = "svg/icons/menu.svg";
	image.alt = "";
	image.draggable = false;
	button.append(image);

	tooltip?.register(button, tooltipKey);

	let popup = null;
	const onOutsidePointer = event => {
		if (popup && !popup.contains(event.target) && !button.contains(event.target)) {
			close();
		}
	};
	const onKeyDown = event => {
		if (popup && event.key === "Escape") {
			event.preventDefault();
			event.stopImmediatePropagation();
			close();
			button.focus();
		}
	};

	function close() {
		if (!popup) {
			return;
		}
		popup.remove();
		popup = null;
		button.setAttribute("aria-expanded", "false");
		document.removeEventListener("pointerdown", onOutsidePointer, true);
		document.removeEventListener("keydown", onKeyDown, true);
	}

	function open() {
		if (popup) {
			close();
			return;
		}
		popup = document.createElement("div");
		popup.className = "item-menu-popup";
		popup.setAttribute("role", "menu");
		for (const item of items) {
			popup.append(makeMenuEntry(document, i18n, tooltip, item, close));
		}
		button.setAttribute("aria-expanded", "true");
		button.after(popup);
		// Flip the popup above the item when there is no room below (e.g. the last row).
		const buttonBox = button.getBoundingClientRect();
		const popupBox = popup.getBoundingClientRect();
		if (buttonBox.bottom + popupBox.height > document.documentElement.clientHeight) {
			popup.classList.add("is-flipped");
		}
		document.addEventListener("pointerdown", onOutsidePointer, true);
		document.addEventListener("keydown", onKeyDown, true);
	}

	button.addEventListener("click", event => {
		event.stopPropagation();
		open();
	});

	return {
		button,
		close,
	};
}
