// "Render video..." and "Render cover..." (PROMPT-v25): build the level file in memory,
// hand it to sunniesnow-record as a Blob, and show progress while FFmpeg writes the file.

import { composeTraits } from "../core/mixin.js";
import { i18n } from "../ui/i18n.js";
import { localizedErrorMessage } from "./app-helpers.js";
import { pickNwSavePath } from "../platform/platform-host.js";
import { createCoverThemeWidget } from "./app-render-cover-widget.js";

class RenderTrait {
	canRenderVideo() {
		return Boolean(globalThis.nw && this.model.music);
	}

	canRenderCover() {
		return Boolean(globalThis.nw);
	}

	showRenderVideoDialog() {
		return showRenderDialog(this, "video");
	}

	showRenderCoverDialog() {
		return showRenderDialog(this, "cover");
	}
}

async function showRenderDialog(app, kind) {
	if (!globalThis.nw) {
		return false;
	}
	const isVideo = kind === "video";
	if (isVideo && !app.model.music) {
		return false;
	}
	const charter = String(app.model.metadata.charter || "").trim();
	const bundledFfmpeg = app.files.bundledFfmpegPath();
	const suggested = `${app.model.metadata.title || "chart"}-${isVideo ? "video.mkv" : "cover.png"}`;
	const outputPath = await pickNwSavePath(suggested, isVideo ? ".mkv,.mp4,.webm" : ".png");
	if (!outputPath) {
		return false;
	}
	const values = await app.dialogs.form({
		titleKey: isVideo ? "command.file.renderVideo" : "command.file.renderCover",
		values: {
			output: outputPath,
			nickname: charter,
			avatar: "online",
			avatarOnline: "default.svg",
			avatarUpload: "",
			avatarGravatar: "",
			useBundledFfmpeg: true,
			speed: "2",
			width: "1920",
			height: "1080",
			fps: "60",
			resultsDuration: "1",
			waitForMusic: true,
		},
		fields: formFields(app, kind, bundledFfmpeg),
		onChange: (next, { entries }) => {
			// Depending on the avatar kind, at most one of the three avatar fields is enabled.
			for (const id of ["avatarOnline", "avatarUpload", "avatarGravatar"]) {
				const entry = entries.find(candidate => candidate.field.id === id);
				if (entry?.control?.element) {
					entry.control.element.disabled = id !== `avatar${capitalize(next.avatar)}`;
				}
			}
		},
	});
	if (!values) {
		return false;
	}
	const coverTheme = kind === "cover" ? app.renderCoverThemeWidget?.read() : null;
	const recordOptions = buildRenderRecordOptions(
		kind,
		values.output,
		values,
		bundledFfmpeg,
		app.files.bundledFontsDir(),
		coverTheme,
	);
	await runRenderWithProgress(app, kind, recordOptions);
	return true;
}

function formFields(app, kind, bundledFfmpeg) {
	const isVideo = kind === "video";
	const fields = [
		{
			id: "output",
			type: "custom",
			labelKey: "field.renderOutput",
			render: (element, value, environment) => {
				const row = element.ownerDocument.createElement("div");
				row.className = "render-output-row";
				const input = element.ownerDocument.createElement("input");
				input.type = "text";
				input.readOnly = true;
				input.value = String(value ?? "");
				const browse = element.ownerDocument.createElement("button");
				browse.type = "button";
				browse.textContent = i18n.t("field.renderBrowse");
				browse.addEventListener("click", async () => {
					const picked = await pickNwSavePath(
						`render${isVideo ? ".mkv" : ".png"}`,
						isVideo ? ".mkv,.mp4,.webm" : ".png",
					);
					if (picked) {
						element.dataset.value = picked;
						input.value = picked;
						environment.onChange?.({ id: "output", value: picked });
					}
				});
				row.append(input, browse);
				element.append(row);
			},
			read: element => element.dataset.value || "",
		},
		{ id: "nickname", type: "text", labelKey: "field.renderNickname" },
		{
			id: "avatar",
			type: "select",
			labelKey: "field.renderAvatar",
			options: ["online", "upload", "gravatar"].map(value => ({
				value,
				label: i18n.t(`field.renderAvatar.${value}`),
			})),
		},
		{ id: "avatarOnline", type: "text", labelKey: "field.renderAvatarOnline" },
		{ id: "avatarUpload", type: "text", labelKey: "field.renderAvatarUpload" },
		{ id: "avatarGravatar", type: "text", labelKey: "field.renderAvatarGravatar" },
	];
	if (bundledFfmpeg) {
		fields.push({
			id: "useBundledFfmpeg",
			type: "checkbox",
			labelKey: "field.renderUseBundledFfmpeg",
		});
	}
	fields.push(
		{ id: "speed", type: "number", labelKey: "field.renderSpeed", step: 0.1, min: 0.1 },
		{ id: "width", type: "integer", labelKey: "field.renderWidth", min: 1, step: 1 },
		{ id: "height", type: "integer", labelKey: "field.renderHeight", min: 1, step: 1 },
	);
	if (isVideo) {
		fields.push(
			{ id: "fps", type: "integer", labelKey: "field.renderFps", min: 1, step: 1 },
			{ id: "resultsDuration", type: "number", labelKey: "field.renderResultsDuration", step: 0.1, min: 0 },
			{ id: "waitForMusic", type: "checkbox", labelKey: "field.renderWaitForMusic" },
		);
		return fields;
	}
	fields.push({
		id: "coverTheme",
		type: "custom",
		labelKey: "field.renderCoverTheme",
		render: element => {
			const widget = createCoverThemeWidget({
				imageUrl: app.model.image ? app.files.backgroundUrl || app.model.image : null,
				documentRef: element.ownerDocument,
			});
			app.renderCoverThemeWidget = widget;
			element.append(widget.element);
		},
		read: () => app.renderCoverThemeWidget?.read(),
	});
	return fields;
}

// Pure option mapping (exported for tests): dialog values -> sunniesnow-record settings.
export function buildRenderRecordOptions(kind, outputPath, values, bundledFfmpeg, bundledFontsDir, coverTheme) {
	const common = {
		nickname: values.nickname || undefined,
		avatar: values.avatar,
		avatarOnline: values.avatar === "online" ? values.avatarOnline || undefined : undefined,
		avatarUpload: values.avatar === "upload" ? values.avatarUpload || undefined : undefined,
		avatarGravatar: values.avatar === "gravatar" ? values.avatarGravatar || undefined : undefined,
		width: Math.max(1, Math.round(Number(values.width) || 1920)),
		height: Math.max(1, Math.round(Number(values.height) || 1080)),
		output: outputPath,
	};
	if (kind === "video") {
		return {
			...common,
			speed: Number(values.speed) || 2,
			fps: Math.max(1, Math.round(Number(values.fps) || 60)),
			resultsDuration: Number(values.resultsDuration) || 1,
			waitForMusic: Boolean(values.waitForMusic),
			assetsDir: bundledFontsDir || undefined,
			ffmpeg: values.useBundledFfmpeg && bundledFfmpeg ? bundledFfmpeg : "ffmpeg",
		};
	}
	return {
		...common,
		assetsDir: bundledFontsDir || undefined,
		coverThemeImageX: coverTheme?.x ?? null,
		coverThemeImageY: coverTheme?.y ?? null,
		coverThemeImageWidth: coverTheme?.width ?? null,
	};
}

// Starts the render job and shows the progress dialog while it runs. The dialog can only
// be confirmed after the rendering finishes, and then offers a button that opens the
// directory containing the rendered file.
async function runRenderWithProgress(app, kind, recordOptions) {
	let updater = null;
	let done = false;
	let state = { ratio: 0, text: i18n.t("status.renderStarting") };
	const job = runRenderJob(app, kind, recordOptions, next => {
		Object.assign(state, next);
		updater?.(state);
	})
		.catch(error => {
			state = { ratio: 0, text: `${i18n.t("status.renderFailed")}: ${localizedErrorMessage(error)}` };
			updater?.(state);
		})
		.finally(() => {
			done = true;
			updater?.(state);
		});
	await app.dialogs.open({
		titleKey: isVideoKind(kind) ? "command.file.renderVideo" : "command.file.renderCover",
		fields: [
			{
				id: "progress",
				type: "custom",
				render: element => {
					element.classList.add("render-progress");
					const bar = element.ownerDocument.createElement("progress");
					bar.className = "render-progress-bar";
					bar.max = 1;
					const status = element.ownerDocument.createElement("div");
					status.className = "render-progress-status";
					const openFolder = element.ownerDocument.createElement("button");
					openFolder.type = "button";
					openFolder.hidden = true;
					openFolder.textContent = i18n.t("command.file.showRenderResult");
					openFolder.addEventListener("click", () => {
						app.files.showItemInFileExplorer(recordOptions.output);
					});
					element.append(bar, status, openFolder);
					updater = next => {
						bar.value = next.ratio;
						status.textContent = next.text;
						if (done) {
							bar.value = 1;
							openFolder.hidden = false;
						}
					};
					updater(state);
				},
				read: () => done,
			},
		],
		buttons: [
			{
				id: "ok",
				labelKey: "dialog.ok",
				primary: true,
				value: true,
				validate: () => (done ? "" : "validation.renderInProgress"),
			},
		],
	});
	done = true;
	updater?.(state);
	await job;
}

// Builds the .ssc level in memory (provided to sunniesnow-record as a Blob) and runs the
// renderer. Video always uses the currently loaded music from the level; the background is
// the loaded image, or "none" when no image is loaded.
async function runRenderJob(app, kind, recordOptions, onProgress) {
	const { default: SunniesnowRecord } = await import("sunniesnow-record");
	const project = app.projectSnapshot();
	if (!app.editingProject) {
		project.charts = project.charts.filter(entry => entry.id === app.activeDifficultyId);
	}
	const blob = await app.files.createLevelArchive(project, { compression: "STORE" });
	const options = {
		levelFile: "upload",
		levelFileUpload: blob,
		chartSelect: "from-level",
		musicSelect: "from-level",
		background: app.model.image ? "from-level" : "none",
		quiet: true,
		suppressWarnings: true,
		...recordOptions,
	};
	const runner = isVideoKind(kind) ? SunniesnowRecord.Record : SunniesnowRecord.CoverGen;
	await runner.run(options, progress => onProgress(renderProgressState(progress)));
}

function isVideoKind(kind) {
	return kind === "video";
}

function capitalize(text) {
	return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

export function renderProgressState(progress) {
	if (!progress || !["loading", "renderingGame", "renderingResult"].includes(progress.status)) {
		return { ratio: 1, text: i18n.t("status.renderCombining") };
	}
	if (progress.status === "loading") {
		const modulesCount = Number(progress.modulesCount) || 0;
		const totalModules = Math.max(1, Number(progress.totalModules) || 1);
		return {
			ratio: (modulesCount / totalModules) * 0.1,
			text: i18n.t("status.renderLoading", { current: modulesCount, total: totalModules }),
		};
	}
	const endTime = Number(progress.endTime);
	const currentTime = Number(progress.currentTime) || 0;
	const ratio = endTime > 0 ? Math.min(1, currentTime / endTime) : 0;
	return {
		ratio: ratio * 0.9 + 0.1,
		text: i18n.t(
			progress.status === "renderingGame" ? "status.renderingGame" : "status.renderingResult",
			{ frames: Number(progress.framesCount) || 0, time: currentTime.toFixed(2) },
		),
	};
}

export const withRender = composeTraits("RenderLayer", RenderTrait);
