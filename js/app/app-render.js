// "Render video..." and "Render cover..." (PROMPT-v25): build the level file in memory,
// hand it to sunniesnow-record as a Blob, and show progress while FFmpeg writes the file.

import { composeTraits } from "../core/mixin.js";
import { i18n } from "../ui/i18n.js";
import { localizedErrorMessage } from "./app-helpers.js";
import { pickNwOpenPath, pickNwSavePath } from "../platform/platform-host.js";
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
	// v0.16.14 issue #4: a running or finished render session is revisited through the
	// same command instead of a fresh form, so a closed progress window can always be
	// reopened ("新建渲染" in the dialog discards the session and shows the form again).
	// v0.16.15: one session per kind, so video and cover can render at the same time
	// (each runs in its own worker process).
	if (renderSessions.has(kind)) {
		return openRenderProgressDialog(app, renderSessions.get(kind));
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
	const session = createRenderSession(kind, recordOptions);
	renderSessions.set(kind, session);
	startRenderJob(app, session);
	await openRenderProgressDialog(app, session);
	return true;
}

// The running or most recently finished render job per kind (video, cover). Keeping
// them around lets the command reopen the progress dialog after its window was closed;
// the renders themselves keep running in their worker processes in the meantime, and
// video and cover can run concurrently.
const renderSessions = new Map();

function createRenderSession(kind, recordOptions) {
	return {
		kind,
		recordOptions,
		output: recordOptions.output,
		state: { ratio: 0, text: i18n.t("status.renderStarting") },
		logLines: [],
		lastLogLine: null,
		updaters: new Set(),
		dialogOpen: false,
		requestNew: null,
		abort: null,
		canceled: false,
		failed: false,
		finished: false,
		lastError: null,
	};
}

function paintRenderSession(session) {
	for (const updater of session.updaters) {
		updater(session.state);
	}
}

// Starts the worker job for a session and drives its state machine: loading / rendering
// / combining progress first, then exactly one of success, failure, or canceled as the
// final status (v0.16.14 issues #1 and #3 — the status line always resolves instead of
// staying on the last stage text like "combining").
function startRenderJob(app, session) {
	return runRenderJob(app, session.kind, session.recordOptions, next => {
		if (next.logLine && next.logLine !== session.lastLogLine) {
			session.lastLogLine = next.logLine;
			session.logLines.push(next.logLine);
			next.log = session.logLines.join("\n");
		}
		Object.assign(session.state, next);
		paintRenderSession(session);
	})
		.catch(error => {
			session.lastError = error;
			if (!session.canceled) {
				session.failed = true;
				session.state = {
					ratio: 0,
					text: `${i18n.t("status.renderFailed")}: ${localizedErrorMessage(error)}`,
					details: renderErrorDetails(error),
				};
			}
		})
		.finally(() => {
			session.finished = true;
			if (session.canceled) {
				session.state = { ratio: 0, text: i18n.t("status.renderCanceled") };
			} else if (!session.failed) {
				session.state = {
					ratio: 1,
					text: i18n.t("status.renderSucceeded", { output: session.output }),
				};
			}
			paintRenderSession(session);
			// v0.16.17: always raise the bottom-right toast on completion (like the
			// autosave notice), whether or not the progress dialog is open.
			if (!session.canceled) {
				if (session.failed) {
					app.toast?.error("toast.renderFailed", {
						message: localizedErrorMessage(session.lastError),
					});
				} else {
					app.toast?.show("toast.renderSucceeded", { output: session.output });
				}
			}
		});
}

// Opens the progress dialog bound to a session, reattachable at any time. "关闭" never
// cancels the render — the job keeps running and the dialog can be reopened through the
// command; the stop button is what terminates the worker (v0.16.14 issue #2).
async function openRenderProgressDialog(app, session) {
	session.dialogOpen = true;
	session.requestNew = () => app.dialogs.close({ button: "new" });
	const result = await app.dialogs.open({
		titleKey: isVideoKind(session.kind) ? "command.file.renderVideo" : "command.file.renderCover",
		fields: [
			{
				id: "progress",
				type: "custom",
				render: ({ document: documentRef }) => {
					const { element, apply, destroy } = createProgressDialogBody(app, session, documentRef);
					session.updaters.add(apply);
					apply(session.state);
					return {
						element,
						read: () => session.finished,
						destroy: () => session.updaters.delete(apply),
					};
				},
			},
		],
		buttons: [
			{
				id: "stop",
				labelKey: "dialog.renderStop",
				onClick: () => {
					// Flag first so a stop clicked before the worker even spawned is
					// honored when it spawns (runRenderWorker checks this).
					session.canceled = true;
					session.abort?.();
					// Stay open: the state machine paints the canceled status when the
					// worker has terminated.
					return false;
				},
			},
			{ id: "close", labelKey: "dialog.close", primary: true, value: true },
		],
	});
	session.dialogOpen = false;
	if (result?.button === "new") {
		renderSessions.delete(session.kind);
		return showRenderDialog(app, session.kind);
	}
	return true;
}

// Builds the shared browse-row control for path fields: a read-only text input
// showing the chosen native path plus a browse button that opens a native dialog
// via `pick`, and reports the result back through the custom-field onChange.
function pathPickerRow({ documentRef, value, onChange, id, pick }) {
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
		const picked = await pick();
		if (picked) {
			input.value = picked;
			onChange?.({ id, value: picked });
		}
	});
	row.append(input, browse);
	return { element: row, read: () => input.value };
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
			render: ({ document: documentRef, value, onChange }) => pathPickerRow({
				documentRef,
				value,
				onChange,
				id: "output",
				pick: () => pickNwSavePath(suggested, isVideo ? ".mkv,.mp4,.webm" : ".png"),
			}),
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
		// v27: avatar fields are disabled declaratively via predicates, which the dialog
		// framework evaluates on open and on every change — so only the avatar kind
		// matching the current selection is enabled, including on first open.
		{
			id: "avatarOnline",
			type: "text",
			labelKey: "field.renderAvatarOnline",
			disabled: values => values.avatar !== "online",
		},
		{
			id: "avatarUpload",
			type: "custom",
			labelKey: "field.renderAvatarUpload",
			disabled: values => values.avatar !== "upload",
			// Same browse-row interaction as the output field, but opens an "open file"
			// dialog since the uploaded avatar is an existing image on disk.
			render: ({ document: documentRef, value, onChange }) => pathPickerRow({
				documentRef,
				value,
				onChange,
				id: "avatarUpload",
				pick: () => pickNwOpenPath(".svg,.png,.jpg,.jpeg,.gif,.webp"),
			}),
		},
		{
			id: "avatarGravatar",
			type: "text",
			labelKey: "field.renderAvatarGravatar",
			disabled: values => values.avatar !== "gravatar",
		},
	];
	// Cover renders skip the video-only controls (FFmpeg bundling, speed, fps, results
	// duration, wait-for-music) and add the theme-image picker instead.
	if (isVideo) {
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
			{ id: "fps", type: "integer", labelKey: "field.renderFps", min: 1, step: 1 },
			{ id: "resultsDuration", type: "number", labelKey: "field.renderResultsDuration", step: 0.1, min: 0 },
			{ id: "waitForMusic", type: "checkbox", labelKey: "field.renderWaitForMusic" },
		);
		return fields;
	}
	fields.push(
		{ id: "width", type: "integer", labelKey: "field.renderWidth", min: 1, step: 1 },
		{ id: "height", type: "integer", labelKey: "field.renderHeight", min: 1, step: 1 },
	);
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

// Builds the render progress dialog body: progress bar, status line, a copyable loading
// log (one line per module, v0.16.11), the failure details box with its copy button
// (v26), the reveal-in-explorer button, and (v0.16.14) a "new rendering" button shown
// once the job reaches a final state. Returns the host element and an `apply` function
// that paints a progress state onto it.
function createProgressDialogBody(app, session, documentRef) {
	const host = documentRef.createElement("div");
	host.classList.add("render-progress");
	const bar = documentRef.createElement("progress");
	bar.className = "render-progress-bar";
	bar.max = 1;
	const status = documentRef.createElement("div");
	status.className = "render-progress-status";
	// v0.16.11: scrollable, copyable log of the loading phase (one line per module), so
	// slow or stuck module loading can be reported in detail.
	const logBox = documentRef.createElement("textarea");
	logBox.className = "render-progress-error";
	logBox.readOnly = true;
	logBox.rows = 7;
	logBox.hidden = true;
	const copyLog = documentRef.createElement("button");
	copyLog.type = "button";
	copyLog.hidden = true;
	copyLog.textContent = i18n.t("field.renderCopyLog");
	copyLog.addEventListener("click", createCopyHandler(documentRef, logBox, copyLog, "field.renderCopyLog"));
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
	copyError.addEventListener("click", createCopyHandler(documentRef, errorBox, copyError, "field.renderCopyError"));
	const openFolder = documentRef.createElement("button");
	openFolder.type = "button";
	openFolder.hidden = true;
	openFolder.textContent = i18n.t("command.file.showRenderResult");
	openFolder.addEventListener("click", () => {
		app.files.showItemInFileExplorer(session.recordOptions.output);
	});
	const newRender = documentRef.createElement("button");
	newRender.type = "button";
	newRender.hidden = true;
	newRender.textContent = i18n.t("field.renderNew");
	newRender.addEventListener("click", () => session.requestNew?.());
	host.append(bar, status, logBox, copyLog, errorBox, copyError, openFolder, newRender);
	const apply = next => {
		bar.value = next.ratio;
		status.textContent = next.text;
		if (next.log) {
			if (logBox.value !== next.log) {
				logBox.value = next.log;
				logBox.scrollTop = logBox.scrollHeight;
			}
			logBox.hidden = false;
			copyLog.hidden = false;
		}
		if (next.details) {
			if (errorBox.value !== next.details) {
				errorBox.value = next.details;
			}
			errorBox.hidden = false;
			copyError.hidden = false;
		}
		if (session.finished) {
			bar.value = 1;
			openFolder.hidden = false;
			newRender.hidden = false;
		}
		// The stop button lives in the dialog actions, not in this body; hide it once
		// the job reached a final state. Guarded because paint can also happen after
		// the dialog was closed (toast path).
		const stopElement = app.dialogs.active?.buttons?.find(button => button.definition.id === "stop")
			?.element;
		if (stopElement) {
			stopElement.hidden = session.finished;
		}
	};
	return { element: host, apply };
}

// Clipboard write with a document.execCommand fallback for non-secure contexts; the
// button label flips to the "copied" feedback on success.
function createCopyHandler(documentRef, box, button, copyKey) {
	return async () => {
		let copied = false;
		try {
			await navigator.clipboard.writeText(box.value);
			copied = true;
		} catch {
			box.focus();
			box.select();
			copied = documentRef.execCommand("copy");
		}
		button.textContent = i18n.t(copied ? "field.renderErrorCopied" : copyKey);
	};
}

// Builds the .ssc level in memory, hands it to the render worker as a temp file, and
// runs the renderer. Video always uses the currently loaded music from the level; the
// background is the loaded image, or "none" when no image is loaded.
async function runRenderJob(app, kind, recordOptions, onProgress, session = {}) {
	const project = app.projectSnapshot();
	if (!app.editingProject) {
		project.charts = project.charts.filter(entry => entry.id === app.activeDifficultyId);
	}
	const fs = nw.require("node:fs");
	const os = nw.require("node:os");
	const path = nw.require("node:path");
	// Collect the exact archived entry names (chart JSON, music) so the worker can select
	// them; sunniesnow-record treats unknown zip-entry values as missing files.
	let levelEntries = { charts: [], music: null, cover: null };
	const blob = await app.files.createLevelArchive(project, {
		compression: "STORE",
		reportEntries: entries => {
			levelEntries = entries;
		},
	});
	const workDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "sviber-render-"));
	try {
		const levelPath = path.join(workDirectory, "level.ssc");
		fs.writeFileSync(levelPath, Buffer.from(await blob.arrayBuffer()));
		fs.writeFileSync(path.join(workDirectory, "request.json"), JSON.stringify({
			kind,
			levelFile: levelPath,
			options: {
				levelFile: "upload",
				// sunniesnow-record resolves zip entries by exact filename; pseudo-values like
				// "from-level" would be treated as a missing file. The archive reports the
				// real names; null lets the game pick the only matching entry as a fallback.
				chartSelect: levelEntries.charts[0] ?? null,
				musicSelect: levelEntries.music ?? null,
				// v0.16.16: "from-level" also needs the actual zip entry name for the
				// background image, otherwise the game never loads it and the cover theme
				// area renders as a black square (Sprite without a texture).
				background: app.model.image ? "from-level" : "none",
				backgroundFromLevel: app.model.image ? levelEntries.cover ?? null : null,
				quiet: true,
				suppressWarnings: true,
				...recordOptions,
			},
		}));
		await runRenderWorker(app, kind, path.join(workDirectory, "request.json"), onProgress, session);
	} finally {
		fs.rmSync(workDirectory, { recursive: true, force: true });
	}
}

// Spawns the standalone Node worker (js/app/render-worker.mjs) and drives it over its
// JSON-line stdout protocol. Progress events map onto the dialog state; a worker error
// (or a non-zero exit) rejects with an error carrying stderr/stdout so the failure box
// can show full details. The session receives an `abort` handle (v0.16.14 issue #2):
// stopping kills the worker and resolves instead of rejecting, so the session state
// machine paints "canceled" rather than a failure.
async function runRenderWorker(app, kind, requestPath, onProgress, session = {}) {
	const fs = nw.require("node:fs");
	const os = nw.require("node:os");
	const path = nw.require("node:path");
	const childProcess = nw.require("node:child_process");
	const appRoot = path.dirname(nw.require.resolve("./package.json"));
	const nodeExecutable = resolveRenderNode(path, fs, appRoot);
	const workerPath = path.join(appRoot, "js", "app", "render-worker.mjs");
	// v0.16.16: the fontconfig env vars must be present at process creation — fontconfig
	// and glib read the environment through the CRT getenv snapshot taken at startup, so
	// assignments inside the worker (process.env.X = ...) are invisible to them. Without
	// this, the pango-win32 backend stays active and every game font falls back to Sans.
	// The worker writes the config file itself before importing sunniesnow-record.
	const spawnEnv = { ...process.env };
	if (process.platform === "win32") {
		spawnEnv.PANGOCAIRO_BACKEND = "fc";
		spawnEnv.FONTCONFIG_FILE = path.join(os.tmpdir(), "sviber-fontconfig.conf");
	}
	return new Promise((resolve, reject) => {
		const child = childProcess.spawn(nodeExecutable, [workerPath, requestPath], {
			windowsHide: true,
			stdio: ["ignore", "pipe", "pipe"],
			env: spawnEnv,
		});
		session.abort = () => {
			session.canceled = true;
			child.kill();
		};
		if (session.canceled) {
			// Stop was clicked before the worker spawned; terminate it right away.
			child.kill();
		}
		let buffer = "";
		let stderrTail = "";
		let done = false;
		let failure = null;
		child.stdout.setEncoding("utf8");
		child.stdout.on("data", chunk => {
			buffer += chunk;
			for (;;) {
				const newline = buffer.indexOf("\n");
				if (newline < 0) {
					break;
				}
				const event = parseRenderWorkerEvent(buffer.slice(0, newline));
				buffer = buffer.slice(newline + 1);
				if (!event) {
					continue;
				}
				if (event.progress) {
					onProgress(renderProgressState(event.progress));
				} else if (event.log) {
					// Game log lines (warnings, loader failures) feed the copyable log box.
					onProgress({ logLine: event.log });
				} else if (event.done) {
					done = true;
					// v0.16.16: the done report is the last event; resolve right away by
					// stopping the worker. Its PIXI ticker keeps the event loop alive after
					// Record/CoverGen finish, so waiting for a natural exit would leave the
					// dialog stuck on the last progress state forever.
					child.kill();
				} else if (event.error) {
					failure = new Error(event.error);
					if (event.details) {
						failure.stack = event.details;
					}
					if (typeof event.stderr === "string") {
						failure.stderr = event.stderr;
					}
					if (Array.isArray(event.stdout)) {
						failure.stdout = event.stdout;
					}
					// The worker may keep hanging after a game termination (the loader loop
					// stalls silently), so abort it as soon as the error report arrives.
					done = true;
					child.kill();
				}
			}
		});
		child.stderr.setEncoding("utf8");
		child.stderr.on("data", chunk => {
			// Keep the tail: if the worker dies before reporting an error (for example a
			// broken import), this carries the actual stack trace for the error box.
			stderrTail = `${stderrTail}${chunk}`.slice(-8000);
		});
		child.on("error", error => reject(
			Object.assign(new Error(`Failed to launch render worker: ${error.message}`), { stderr: stderrTail }),
		));
		child.on("close", code => {
			if (session.canceled) {
				// User-initiated stop: not a failure, the state machine paints "canceled".
				resolve();
			} else if (done && !failure) {
				resolve();
			} else if (failure) {
				reject(failure);
			} else {
				reject(new Error(`Render worker exited with code ${code}.\n${stderrTail}`));
			}
		});
	});
}

// Packaged builds bundle the Node runtime that the native render dependencies were
// built against (scripts/build-nw.mjs copies the running Node into runtime/); in dev
// ("nw .") the Node available on PATH is used instead.
function resolveRenderNode(path, fs, appRoot) {
	const bundled = path.join(appRoot, "runtime", process.platform === "win32" ? "node.exe" : "node");
	return fs.existsSync(bundled) ? bundled : "node";
}

// Pure parser (exported for tests): one stdout line of the render worker -> event
// object, or null for blank/non-JSON lines.
export function parseRenderWorkerEvent(line) {
	if (!line?.trim()) {
		return null;
	}
	try {
		const event = JSON.parse(line);
		return typeof event === "object" && event !== null ? event : null;
	} catch {
		return null;
	}
}

function isVideoKind(kind) {
	return kind === "video";
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
		const currentModule = progress.currentModule ? String(progress.currentModule) : "";
		const state = {
			ratio: (modulesCount / totalModules) * 0.1,
			text: i18n.t(
				currentModule ? "status.renderLoadingModule" : "status.renderLoading",
				{ current: modulesCount, total: totalModules, module: currentModule },
			),
		};
		// v0.16.11: feed the copyable progress log — one line per module being loaded.
		state.logLine = state.text;
		return state;
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
