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
	const values = await app.dialogs.form({
		titleKey: isVideo ? "command.file.renderVideo" : "command.file.renderCover",
		values: {
			output: "",
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
		fields: formFields(app, kind, bundledFfmpeg, suggested),
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
	const outputPath = values.output;
	if (!outputPath) {
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

function formFields(app, kind, bundledFfmpeg, suggested) {
	const isVideo = kind === "video";
	const fields = [
		{
			id: "output",
			type: "custom",
			labelKey: "field.renderOutput",
			required: true,
			// Custom fields receive an environment object ({ document, i18n, value, onChange })
			// and return a control object ({ element, read }); see createCustomControl.
			render: ({ document: documentRef, value, onChange }) => {
				const row = documentRef.createElement("div");
				row.className = "render-output-row";
				const input = documentRef.createElement("input");
				input.type = "text";
				input.readOnly = true;
				input.value = String(value ?? "");
				const browse = documentRef.createElement("button");
				browse.type = "button";
				browse.textContent = i18n.t("field.renderBrowse");
				browse.addEventListener("click", async () => {
					const picked = await pickNwSavePath(
						suggested,
						isVideo ? ".mkv,.mp4,.webm" : ".png",
					);
					if (picked) {
						input.value = picked;
						onChange?.({ id: "output", value: picked });
					}
				});
				row.append(input, browse);
				return { element: row, read: () => input.value };
			},
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
		render: ({ document: documentRef }) => {
			const widget = createCoverThemeWidget({
				imageUrl: app.model.image ? app.files.backgroundUrl || app.model.image : null,
				documentRef,
			});
			app.renderCoverThemeWidget = widget;
			return { element: widget.element, read: () => app.renderCoverThemeWidget?.read() };
		},
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
			state = {
				ratio: 0,
				text: `${i18n.t("status.renderFailed")}: ${localizedErrorMessage(error)}`,
				details: renderErrorDetails(error),
			};
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
				render: ({ document: documentRef }) => {
					const host = documentRef.createElement("div");
					host.classList.add("render-progress");
					const bar = documentRef.createElement("progress");
					bar.className = "render-progress-bar";
					bar.max = 1;
					const status = documentRef.createElement("div");
					status.className = "render-progress-status";
					// v26: render failures show a scrollable, selectable error box plus a copy
					// button so the full details (message, FFmpeg stderr, stack) can be reported.
					const errorBox = documentRef.createElement("textarea");
					errorBox.className = "render-progress-error";
					errorBox.readOnly = true;
					errorBox.rows = 7;
					errorBox.hidden = true;
					const copyError = documentRef.createElement("button");
					copyError.type = "button";
					copyError.hidden = true;
					copyError.textContent = i18n.t("field.renderCopyError");
					copyError.addEventListener("click", async () => {
						let copied = false;
						try {
							await navigator.clipboard.writeText(errorBox.value);
							copied = true;
						} catch {
							errorBox.focus();
							errorBox.select();
							copied = documentRef.execCommand("copy");
						}
						copyError.textContent = i18n.t(copied ? "field.renderErrorCopied" : "field.renderCopyError");
					});
					const openFolder = documentRef.createElement("button");
					openFolder.type = "button";
					openFolder.hidden = true;
					openFolder.textContent = i18n.t("command.file.showRenderResult");
					openFolder.addEventListener("click", () => {
						app.files.showItemInFileExplorer(recordOptions.output);
					});
					host.append(bar, status, errorBox, copyError, openFolder);
					updater = next => {
						bar.value = next.ratio;
						status.textContent = next.text;
						if (next.details) {
							if (errorBox.value !== next.details) {
								errorBox.value = next.details;
							}
							errorBox.hidden = false;
							copyError.hidden = false;
						}
						if (done) {
							bar.value = 1;
							openFolder.hidden = false;
						}
					};
					updater(state);
					return { element: host, read: () => done };
				},
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

// Gathers everything useful from a render failure for the copyable error box: the
// message, any FFmpeg stderr/stdout attached to the error, and the stack trace.
export function renderErrorDetails(error) {
	const message = error?.message ?? error;
	const stack = error?.stack && String(error.stack).trim() ? String(error.stack).trim() : null;
	const parts = [];
	if (stack && (!message || !String(message).trim() || stack.includes(String(message)))) {
		// The stack trace already carries the message; keep the full trace only.
		parts.push(stack);
	} else {
		if (message != null && String(message).trim()) {
			parts.push(String(message));
		}
		if (stack) {
			parts.push(stack);
		}
	}
	const stderr = error?.stderr;
	if (typeof stderr === "string" && stderr.trim()) {
		parts.push(`--- FFmpeg stderr ---\n${stderr.trim()}`);
	} else if (Array.isArray(stderr) && stderr.length) {
		parts.push(`--- FFmpeg stderr ---\n${stderr.map(line => String(line)).join("\n").trim()}`);
	}
	const stdout = error?.stdout;
	if (Array.isArray(stdout) && stdout.length) {
		parts.push(`--- FFmpeg stdout ---\n${stdout.map(line => String(line)).join("\n").trim()}`);
	}
	return parts.join("\n\n") || String(error ?? "");
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
