export function eventClickSelectionMode({ selected = false, ctrlKey = false, altKey = false } = {}) {
	if (altKey) return "remove";
	if (ctrlKey) return "add";
	return selected ? "remove" : "replace";
}
