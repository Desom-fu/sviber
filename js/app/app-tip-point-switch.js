// Popup form for creating, editing and deleting a tip point switch at the current time.

import { composeTraits } from "../core/mixin.js";
import { i18n } from "../ui/i18n.js";
import { clearTipPointSwitch, permutationImages, writeTipPointSwitch } from "../core/tip-point-track.js";

function moveIndex(list, index, delta) {
	const next = index + delta;
	if (next < 0 || next >= list.length) {
		return list;
	}
	const copy = list.slice();
	const [item] = copy.splice(index, 1);
	copy.splice(next, 0, item);
	return copy;
}

class TipPointSwitchTrait {
	async showTipPointSwitchDialog() {
		const time = this.currentBeat();
		const channels = this.model.channels;
		let images = permutationImages(channels, time);
		const content = document.createElement("div");
		content.className = "tip-switch-editor";
		const left = document.createElement("ol");
		left.className = "tip-switch-column is-source";
		const right = document.createElement("ol");
		right.className = "tip-switch-column is-target";
		content.append(left, right);

		const render = () => {
			left.replaceChildren();
			right.replaceChildren();
			channels.forEach((channel, index) => {
				const source = document.createElement("li");
				source.textContent = channel.name;
				left.append(source);
				const target = document.createElement("li");
				const name = channels.find(item => item.id === images[index])?.name || String(images[index]);
				const label = document.createElement("span");
				label.textContent = name;
				const up = document.createElement("button");
				up.type = "button";
				up.textContent = "\u2191";
				up.disabled = index === 0;
				up.addEventListener("click", () => {
					images = moveIndex(images, index, -1);
					render();
				});
				const down = document.createElement("button");
				down.type = "button";
				down.textContent = "\u2193";
				down.disabled = index === channels.length - 1;
				down.addEventListener("click", () => {
					images = moveIndex(images, index, 1);
					render();
				});
				target.draggable = true;
				target.addEventListener("dragstart", event => {
					event.dataTransfer.setData("text/plain", String(index));
				});
				target.addEventListener("dragover", event => event.preventDefault());
				target.addEventListener("drop", event => {
					event.preventDefault();
					const from = Number(event.dataTransfer.getData("text/plain"));
					if (!Number.isInteger(from) || from === index) {
						return;
					}
					const copy = images.slice();
					const [item] = copy.splice(from, 1);
					copy.splice(index, 0, item);
					images = copy;
					render();
				});
				target.append(label, up, down);
				right.append(target);
			});
		};
		render();

		const result = await this.dialogs.open({
			titleKey: "dialog.tipPointSwitch",
			content,
			buttons: [
				{ id: "ok", labelKey: "dialog.ok", primary: true, submit: true, value: "save" },
				{ id: "delete", labelKey: "dialog.delete", value: "delete", validate: false },
				{ id: "cancel", labelKey: "dialog.cancel", value: null, cancel: true, validate: false },
			],
		});
		if (!result || result.button === "cancel") {
			return;
		}
		this.commit(i18n.t("history.tipPointSwitch"), model => {
			if (result.button === "delete") {
				clearTipPointSwitch(model.channels, time);
				return;
			}
			writeTipPointSwitch(model.channels, time, images);
		});
	}
}

export const withTipPointSwitch = composeTraits("TipPointSwitchLayer", TipPointSwitchTrait);
