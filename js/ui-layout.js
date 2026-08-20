export function bindEdgeToggleReveal(stage) {
	if (!stage) return;
	const clear = () => stage.classList.remove("is-hovering-left-edge", "is-hovering-right-edge");
	stage.addEventListener("pointermove", event => {
		const bounds = stage.getBoundingClientRect();
		const offset = event.clientX - bounds.left;
		stage.classList.toggle("is-hovering-left-edge", offset <= 28);
		stage.classList.toggle("is-hovering-right-edge", offset >= bounds.width - 28);
	});
	stage.addEventListener("pointerleave", clear);
}
