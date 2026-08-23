export const ICON_BASE = 'svg/icons';

const icon = name => `${ICON_BASE}/${name}.svg`;

function define(id, shortcut = null, iconName = null, options = {}) {
	return Object.freeze({
		id,
		labelKey: `command.${id}`,
		hintKey: `command.${id}.hint`,
		shortcut,
		icon: iconName ? icon(iconName) : null,
		...options
	});
}

const DEFINITIONS = [
	define('file.newProject', 'Ctrl+Shift+N', null, {desktopOnly: true, blockDuringPlayback: true}),
	define('file.newChart', null, null, {blockDuringPlayback: true}),
	define('file.openProject', 'Ctrl+Shift+O', null, {desktopOnly: true, blockDuringPlayback: true}),
	define('file.openChart', 'Ctrl+O', null, {blockDuringPlayback: true}),
	define('file.openRecent', null, null, {blockDuringPlayback: true}),
	define('file.openAutosave', null, null, {blockDuringPlayback: true}),
	define('file.importFile', null, null, {blockDuringPlayback: true}),
	define('file.setMusic', null, null, {blockDuringPlayback: true}),
	define('file.setBackground', null, null, {blockDuringPlayback: true}),
	define('file.save', 'Ctrl+S', null, {allowInInput: true}),
	define('file.saveAs', null, null, {allowInInput: true, blockDuringPlayback: true}),
	define('file.saveProject', null, null, {allowInInput: true, desktopOnly: true}),
	define('file.saveLevel', 'Ctrl+Shift+S', null, {allowInInput: true}),
	define('file.importClipboard', null, null, {blockDuringPlayback: true}),
	define('file.exportLyrica', null, null, {blockDuringPlayback: true}),
	define('file.exportClipboard'),
	define('file.openProjectFolder', null, null, {desktopOnly: true}),
	define('file.chartProperties', null, null, {blockDuringPlayback: true}),
	define('file.deleteChart', null, null, {desktopOnly: true, blockDuringPlayback: true}),
	define('file.preferences', 'Ctrl+/', null, {allowInInput: true, blockDuringPlayback: true}),

	define('edit.undo', 'Ctrl+Z'),
	define('edit.redo', 'Ctrl+Y'),
	define('edit.cut', 'Ctrl+X'),
	define('edit.copy', 'Ctrl+C'),
	define('edit.saveClip', 'Ctrl+Shift+C', null, {blockDuringPlayback: true}),
	define('edit.paste', 'Ctrl+V', null, {blockDuringPlayback: true}),
	define('edit.pasteOptions', 'Ctrl+Shift+V', null, {blockDuringPlayback: true}),
	define('edit.pasteDuplicateSnappees', 'Ctrl+Shift+V', null, {blockDuringPlayback: true}),
	define('edit.selectAll', 'Ctrl+A'),
	define('edit.selectChannel', 'Ctrl+Shift+A'),
	define('edit.selectNone', 'Ctrl+D', null, {allowWhenBlocked: true}),
	define('edit.selectAttached'),
	define('edit.selectFilter', 'Ctrl+F', null, {blockDuringPlayback: true}),
	define('edit.delete', 'Delete'),

	define('events.tap', 'T', 'create-tap', {checkable: true, blockDuringPlayback: true}),
	define('events.hold', 'H', 'create-hold', {checkable: true, blockDuringPlayback: true}),
	define('events.drag', 'D', 'create-drag', {checkable: true, blockDuringPlayback: true}),
	define('events.flick', 'F', 'create-flick', {checkable: true, blockDuringPlayback: true}),
	define('events.bgNote', 'B', 'create-bg-note', {checkable: true, blockDuringPlayback: true}),
	define('events.bgPattern', 'P', 'create-bg-pattern', {blockDuringPlayback: true}),
	define('events.bpmChange', 'M', 'bpm-change', {blockDuringPlayback: true}),
	define('events.comment', 'Ctrl+M', null, {blockDuringPlayback: true}),
	define('events.group', 'Ctrl+G', null, {blockDuringPlayback: true}),
	define('events.ungroup', 'Ctrl+Shift+G', null, {blockDuringPlayback: true}),
	define('events.moveChannelAbove', 'Ctrl+Shift+ArrowUp', 'move-to-channel-above'),
	define('events.moveChannelBelow', 'Ctrl+Shift+ArrowDown', 'move-to-channel-below'),
	define('events.reverseTime'),
	define('events.fillCurveDrag', null, null, {blockDuringPlayback: true}),

	define('timing.offsetAndBpm'),
	define('timing.barLine', 'R', 'bar-line', {blockDuringPlayback: true}),
	define('timing.copy', null, null, {allowWhenBlocked: true}),
	define('timing.paste', null, null, {blockDuringPlayback: true}),

	define('channel.createAbove', 'Insert', 'create-channel-above'),
	define('channel.createBelow', 'Shift+Insert', 'create-channel-below'),
	define('channel.delete', null, 'delete-channel'),
	define('channel.moveUp', 'Ctrl+ArrowUp', 'move-channel-up'),
	define('channel.moveDown', 'Ctrl+ArrowDown', 'move-channel-down'),
	define('channel.selectAbove', 'Alt+ArrowUp'),
	define('channel.selectBelow', 'Alt+ArrowDown'),
	define('channel.select1', 'Alt+1'),
	define('channel.select2', 'Alt+2'),
	define('channel.select3', 'Alt+3'),
	define('channel.select4', 'Alt+4'),
	define('channel.select5', 'Alt+5'),
	define('channel.select6', 'Alt+6'),
	define('channel.select7', 'Alt+7'),
	define('channel.select8', 'Alt+8'),
	define('channel.select9', 'Alt+9'),
	define('channel.selectLast', 'Alt+0'),

	define('snappee.rectangularMesh', 'Ctrl+R', 'create-rectangular-mesh', {blockDuringPlayback: true}),
	define('snappee.radialMesh', null, 'create-radial-mesh', {blockDuringPlayback: true}),
	define('snappee.parametricMesh', null, null, {blockDuringPlayback: true}),
	define('snappee.regularPolygon', null, 'create-regular-polygon-mesh', {blockDuringPlayback: true}),
	define('snappee.bezierCurve', 'Ctrl+B', 'create-bezier-curve', {checkable: true, blockDuringPlayback: true}),
	define('snappee.circularArc', null, 'create-circular-curve', {checkable: true, blockDuringPlayback: true}),
	define('snappee.pen', 'Ctrl+P', 'pen', {checkable: true, blockDuringPlayback: true}),
	define('snappee.parametricCurve', null, null, {blockDuringPlayback: true}),
	define('snappee.preset', null, null, {blockDuringPlayback: true}),
	define('snappee.activate', 'A', 'activate-snappee'),
	define('snappee.deactivate', 'Shift+A', 'deactivate-snappee'),
	define('snappee.attach', 'S', 'attach'),
	define('snappee.detach', 'Shift+S', 'detach'),

	define('transform.moveLeft', 'ArrowLeft'),
	define('transform.moveDown', 'ArrowDown'),
	define('transform.moveUp', 'ArrowUp'),
	define('transform.moveRight', 'ArrowRight'),
	define('transform.moveLeftLarge', 'Shift+ArrowLeft'),
	define('transform.moveDownLarge', 'Shift+ArrowDown'),
	define('transform.moveUpLarge', 'Shift+ArrowUp'),
	define('transform.moveRightLarge', 'Shift+ArrowRight'),
	define('transform.flipHorizontal', '%', 'flip-horizontally'),
	define('transform.flipVertical', '"', 'flip-vertically'),
	define('transform.free', 'Ctrl+T', 'free-transform', {checkable: true, blockDuringPlayback: true}),
	define('transform.matrix', null, null, {blockDuringPlayback: true}),
	define('transform.moveForward', '>'),
	define('transform.moveBackward', '<'),
	define('transform.timeDilation', null, null, {blockDuringPlayback: true}),

	define('music.playPause', 'Space', 'play-pause', {checkable: true, allowWhenBlocked: true}),
	define('music.playReverse', 'Shift+Space', null, {checkable: true, allowWhenBlocked: true}),
	define('music.seekStart', 'Home', 'seek-to-start', {allowWhenBlocked: true}),
	define('music.seekForward', '.', null, {allowWhenBlocked: true}),
	define('music.seekBackward', ',', null, {allowWhenBlocked: true}),
	define('music.seekForward3', 'Ctrl+.', null, {allowWhenBlocked: true}),
	define('music.seekBackward3', 'Ctrl+,', null, {allowWhenBlocked: true}),
	define('music.abLoop', 'L', null, {blockDuringPlayback: true}),
	define('music.subdivision1', '1', 'time-lattice-1', {checkable: true, group: 'subdivision', allowWhenBlocked: true}),
	define('music.subdivision2', '2', 'time-lattice-2', {checkable: true, group: 'subdivision', allowWhenBlocked: true}),
	define('music.subdivision3', '3', 'time-lattice-3', {checkable: true, group: 'subdivision', allowWhenBlocked: true}),
	define('music.subdivision4', '4', 'time-lattice-4', {checkable: true, group: 'subdivision', allowWhenBlocked: true}),
	define('music.subdivision6', '6', 'time-lattice-6', {checkable: true, group: 'subdivision', allowWhenBlocked: true}),
	define('music.subdivision8', '8', 'time-lattice-8', {checkable: true, group: 'subdivision', allowWhenBlocked: true}),
	define('music.subdivisionOther', '0', null, {allowWhenBlocked: true}),
	define('music.speedDecrease', '[', null, {allowWhenBlocked: true}),
	define('music.speedIncrease', ']', null, {allowWhenBlocked: true}),
	define('music.speed025', 'Ctrl+4', 'speed-0-25', {checkable: true, group: 'speed', allowWhenBlocked: true}),
	define('music.speed05', 'Ctrl+2', 'speed-0-5', {checkable: true, group: 'speed', allowWhenBlocked: true}),
	define('music.speed1', 'Ctrl+1', 'speed-1', {checkable: true, group: 'speed', allowWhenBlocked: true}),
	define('music.zoomIn', 'Ctrl+=', 'zoom-in', {allowWhenBlocked: true}),
	define('music.zoomOut', 'Ctrl+-', 'zoom-out', {allowWhenBlocked: true}),
	define('timeline.pageForward', 'PageUp', null, {allowWhenBlocked: true}),
	define('timeline.pageBackward', 'PageDown', null, {allowWhenBlocked: true}),

	define('macros.open', 'Ctrl+Alt+M', 'macros', {allowWhenBlocked: true}),
	define('macros.run', null, null, {allowWhenBlocked: true, blockDuringPlayback: true}),

	define('help.documentation', 'F1', null, {allowWhenBlocked: true}),
	define('help.keyboardShortcuts', '?', null, {allowWhenBlocked: true}),
	define('help.reportIssues'),
	define('help.about', null, null, {blockDuringPlayback: true})
];

export const COMMAND_DEFINITIONS = Object.freeze(Object.fromEntries(
	DEFINITIONS.map(definition => [definition.id, definition])
));

const separator = Object.freeze({type: 'separator'});
const item = command => Object.freeze({type: 'command', command});

export const MENU_DEFINITION = Object.freeze([
	Object.freeze({
		id: 'file', labelKey: 'menu.file', mnemonic: 'f', items: Object.freeze([
			item('file.newProject'), item('file.newChart'), separator,
			item('file.openProject'), item('file.openChart'), item('file.openRecent'), item('file.openAutosave'), separator,
			item('file.save'), item('file.saveAs'), item('file.saveProject'), separator,
			item('file.importFile'), item('file.importClipboard'), separator,
			item('file.saveLevel'), item('file.exportLyrica'), item('file.exportClipboard'), separator,
			item('file.setMusic'), item('file.setBackground'), separator,
			item('file.openProjectFolder'), separator,
			item('file.chartProperties'), separator, item('file.deleteChart'), separator, item('file.preferences')
		])
	}),
	Object.freeze({
		id: 'edit', labelKey: 'menu.edit', mnemonic: 'e', items: Object.freeze([
			item('edit.undo'), item('edit.redo'), item('edit.cut'), item('edit.copy'), item('edit.saveClip'),
			item('edit.paste'), item('edit.pasteOptions'), separator,
			item('edit.selectAll'), item('edit.selectChannel'), item('edit.selectNone'), item('edit.selectAttached'),
			item('edit.selectFilter'), separator, item('edit.delete')
		])
	}),
	Object.freeze({
		id: 'timing', labelKey: 'menu.timing', mnemonic: 't', items: Object.freeze([
			item('timing.offsetAndBpm'), item('events.bpmChange'), item('timing.barLine'), separator, item('timing.copy'), item('timing.paste')
		])
	}),
	Object.freeze({
		id: 'events', labelKey: 'menu.events', mnemonic: 'v', items: Object.freeze([
			item('events.tap'), item('events.hold'), item('events.drag'), item('events.flick'),
			separator, item('events.bgNote'), item('events.bgPattern'), separator,
			item('events.comment'), separator, item('events.group'), item('events.ungroup'), separator, item('events.reverseTime'),
			item('events.fillCurveDrag')
		])
	}),
	Object.freeze({
		id: 'channel', labelKey: 'menu.channel', mnemonic: 'c', items: Object.freeze([
			item('events.moveChannelAbove'), item('events.moveChannelBelow'), separator,
			item('channel.createAbove'), item('channel.createBelow'), separator, item('channel.delete'),
			separator, item('channel.moveUp'), item('channel.moveDown')
		])
	}),
	Object.freeze({
		id: 'snappee', labelKey: 'menu.snappee', mnemonic: 's', items: Object.freeze([
			item('snappee.rectangularMesh'), item('snappee.radialMesh'),
			item('snappee.parametricMesh'), separator, item('snappee.regularPolygon'),
			item('snappee.bezierCurve'), item('snappee.circularArc'), item('snappee.pen'),
			item('snappee.parametricCurve'), separator, item('snappee.preset'), separator, item('snappee.activate'),
			item('snappee.deactivate'), separator, item('snappee.attach'), item('snappee.detach')
		])
	}),
	Object.freeze({
		id: 'transform', labelKey: 'menu.transform', mnemonic: 'r', items: Object.freeze([
			item('transform.moveLeft'), item('transform.moveDown'), item('transform.moveUp'),
			item('transform.moveRight'), item('transform.moveLeftLarge'),
			item('transform.moveDownLarge'), item('transform.moveUpLarge'),
			item('transform.moveRightLarge'), separator, item('transform.flipHorizontal'),
			item('transform.flipVertical'), item('transform.free'), item('transform.matrix'), separator,
			item('transform.moveForward'), item('transform.moveBackward'), item('transform.timeDilation')
		])
	}),
	Object.freeze({
		id: 'music', labelKey: 'menu.music', mnemonic: 'm', items: Object.freeze([
			item('music.playPause'), item('music.playReverse'), separator, item('music.seekStart'), item('music.seekForward'),
			item('music.seekBackward'), item('music.seekForward3'), item('music.seekBackward3'),
			separator, item('music.abLoop'),
			separator, item('music.subdivision1'), item('music.subdivision2'),
			item('music.subdivision3'), item('music.subdivision4'), item('music.subdivision6'),
			item('music.subdivision8'), item('music.subdivisionOther'), separator,
			item('music.speedDecrease'), item('music.speedIncrease'), item('music.speed025'),
			item('music.speed05'), item('music.speed1'), separator, item('music.zoomIn'),
			item('music.zoomOut')
		])
	}),
	Object.freeze({
		id: 'macros', labelKey: 'menu.macros', mnemonic: 'a', items: Object.freeze([
			item('macros.open'), item('macros.run')
		])
	}),
	Object.freeze({
		id: 'help', labelKey: 'menu.help', mnemonic: 'h', items: Object.freeze([
			item('help.documentation'), item('help.keyboardShortcuts'), item('help.reportIssues'), separator, item('help.about')
		])
	})
]);

export const TOOLBAR_ITEMS = Object.freeze([
	'events.tap', 'events.hold', 'events.drag', 'events.flick', 'events.bgNote',
	'events.bgPattern', 'separator', 'events.bpmChange', 'timing.barLine', 'separator', 'events.moveChannelAbove',
	'events.moveChannelBelow', 'channel.createAbove', 'channel.createBelow',
	'channel.delete', 'separator',
	'snappee.rectangularMesh', 'snappee.radialMesh', 'snappee.regularPolygon',
	'snappee.bezierCurve', 'snappee.circularArc', 'snappee.pen', 'snappee.activate',
	'snappee.deactivate', 'snappee.attach', 'snappee.detach', 'separator',
	'transform.flipHorizontal', 'transform.flipVertical', 'transform.free', 'separator', 'music.playPause', 'music.seekStart',
	'music.subdivision2', 'music.subdivision4', 'music.speed025', 'music.speed05',
	'music.speed1', 'music.zoomIn', 'music.zoomOut', 'separator', 'macros.open'
]);

const KEY_ALIASES = Object.freeze({
	' ': 'space',
	spacebar: 'space',
	del: 'delete',
	esc: 'escape',
	up: 'arrowup',
	down: 'arrowdown',
	left: 'arrowleft',
	right: 'arrowright'
});

const IMPLICIT_SHIFT_KEYS = new Set('~!@#$%^&*()_+{}|:"<>?'.split(''));

function normalizeKey(key) {
	const value = String(key || '').toLowerCase();
	return KEY_ALIASES[value] || value;
}

export function parseShortcut(shortcut) {
	if (!shortcut) {
		return null;
	}
	const result = {ctrl: false, shift: false, alt: false, meta: false, key: ''};
	for (const rawToken of shortcut.split('+')) {
		const token = rawToken.trim();
		switch (token.toLowerCase()) {
			case 'ctrl':
			case 'control':
				result.ctrl = true;
				break;
			case 'shift':
				result.shift = true;
				break;
			case 'alt':
				result.alt = true;
				break;
			case 'meta':
			case 'cmd':
			case 'command':
				result.meta = true;
				break;
			default:
				result.key = normalizeKey(token);
		}
	}
	if (IMPLICIT_SHIFT_KEYS.has(result.key)) {
		result.shift = true;
	}
	return Object.freeze(result);
}

export function matchesShortcut(event, shortcut, {metaAsCtrl = false} = {}) {
	const parsed = typeof shortcut === 'string' ? parseShortcut(shortcut) : shortcut;
	if (!parsed || !parsed.key || event.isComposing) {
		return false;
	}
	const ctrl = event.ctrlKey || (metaAsCtrl && event.metaKey && !parsed.meta);
	const meta = metaAsCtrl && parsed.ctrl ? false : event.metaKey;
	return normalizeKey(event.key) === parsed.key
		&& ctrl === parsed.ctrl
		&& event.shiftKey === parsed.shift
		&& event.altKey === parsed.alt
		&& meta === parsed.meta;
}

export function isEditableTarget(target) {
	if (!target || typeof target.closest !== 'function') {
		return false;
	}
	const editable = target.closest('input, textarea, select, [contenteditable="true"]');
	if (!editable) return false;
	if (editable.matches?.("#difficulty-select")) return false;
	return !editable.matches?.('input[type="checkbox"], input[type="radio"]');
}

export function isSpaceKey(event) {
	return event?.key === ' ' || event?.key === 'Spacebar' || event?.code === 'Space';
}

export function suppressControlSpaceActivation(event, target = event?.target) {
	if (!isSpaceKey(event) || event.isComposing || !(event.ctrlKey || event.metaKey)) return false;
	if (isEditableTarget(target)) return false;
	event.preventDefault();
	return true;
}

function valueOf(value, context, fallback) {
	if (typeof value === 'function') {
		return value(context);
	}
	return value == null ? fallback : value;
}

function allowedWhileReadOnly(definition, context) {
	if (definition.allowWhenReadOnly === true) return true;
	if (typeof definition.allowWhenReadOnly === 'function') return Boolean(definition.allowWhenReadOnly(context, definition.id));
	const id = definition.id;
	if (id.startsWith('music.') || id.startsWith('timeline.') || id.startsWith('channel.select')) return true;
	if (id === 'file.preferences' || id === 'macros.open' || id === 'macros.run' || id.startsWith('help.')) return true;
	if (id.startsWith('edit.select') || id === 'edit.copy' || id === 'events.comment') return true;
	return Boolean(context?.readOnlyCommandAllowed?.(id));
}

export class CommandRegistry {
	constructor(definitions = COMMAND_DEFINITIONS, options = {}) {
		this.definitions = definitions;
		this.records = new Map();
		this.listeners = new Set();
		this.blocked = options.blocked || (() => false);
		this.playbackBlocked = options.playbackBlocked || (() => false);
		this.hardBlocked = options.hardBlocked || (() => false);
		this.metaAsCtrl = options.metaAsCtrl ?? /Mac|iPhone|iPad/.test(globalThis.navigator?.platform || '');
		for (const definition of Object.values(definitions)) {
			this.records.set(definition.id, {
				definition,
				action: null,
				enabled: true,
				checked: false
			});
		}
	}

	has(id) {
		return this.records.has(id);
	}

	get(id) {
		const record = this.records.get(id);
		if (!record) {
			throw new Error(`Unknown command: ${id}`);
		}
		return record;
	}

	register(id, handlers = {}) {
		const record = this.get(id);
		if (typeof handlers === 'function') {
			record.action = handlers;
		} else {
			for (const key of ['action', 'enabled', 'checked']) {
				if (Object.hasOwn(handlers, key)) {
					record[key] = handlers[key];
				}
			}
		}
		this.notify(id);
		return this;
	}

	setAction(id, action) {
		return this.register(id, {action});
	}

	setEnabled(id, enabled) {
		return this.register(id, {enabled});
	}

	setChecked(id, checked) {
		const record = this.get(id);
		if (checked && record.definition.group) {
			for (const [otherId, other] of this.records) {
				if (otherId !== id && other.definition.group === record.definition.group && other.checked === true) {
					other.checked = false;
					this.notify(otherId);
				}
			}
		}
		record.checked = checked;
		this.notify(id);
		return this;
	}

	isEnabled(id, context) {
		const record = this.get(id);
		if (record.definition.desktopOnly && !globalThis.nw) return false;
		if (this.hardBlocked(context) && !record.definition.allowWhenHardBlocked) return false;
		if (context?.model?.editor?.readOnly && !allowedWhileReadOnly(record.definition, context)) return false;
		if (this.playbackBlocked(context) && record.definition.blockDuringPlayback) return false;
		if (this.blocked(context) && !record.definition.allowWhenBlocked) {
			return false;
		}
		return Boolean(valueOf(record.enabled, context, true));
	}

	isChecked(id, context) {
		return Boolean(valueOf(this.get(id).checked, context, false));
	}

	state(id, context) {
		const record = this.get(id);
		return Object.freeze({
			id,
			definition: record.definition,
			enabled: this.isEnabled(id, context),
			checked: this.isChecked(id, context)
		});
	}

	async execute(id, context, event) {
		const record = this.get(id);
		if (!this.isEnabled(id, context) || typeof record.action !== 'function') {
			return false;
		}
		this.emit({type: 'execute', id, phase: 'before', state: this.state(id, context)});
		const result = await record.action(context, event, record.definition);
		this.emit({type: 'execute', id, phase: 'after', result, state: this.state(id, context)});
		return result === undefined ? true : result;
	}

	handleKeyboard(event, context) {
		if (event.defaultPrevented || event.isComposing) {
			return false;
		}
		const focusedTarget = event.target || globalThis.document?.activeElement;
		for (const definition of Object.values(this.definitions)) {
			if (!definition.shortcut || isEditableTarget(focusedTarget) && !definition.allowInInput) {
				continue;
			}
			if (!matchesShortcut(event, definition.shortcut, {metaAsCtrl: this.metaAsCtrl})) {
				continue;
			}
			if (event.repeat && (definition.id === 'music.playPause' || definition.id === 'music.playReverse')) {
				event.preventDefault();
				return true;
			}
			if (!this.isEnabled(definition.id, context)) {
				return false;
			}
			event.preventDefault();
			event.stopImmediatePropagation();
			void this.execute(definition.id, context, event);
			return true;
		}
		suppressControlSpaceActivation(event, focusedTarget);
		return false;
	}

	attachKeyboard(target = globalThis.document, contextProvider = () => undefined) {
		if (!target?.addEventListener) {
			return () => {};
		}
		const listener = event => this.handleKeyboard(event, contextProvider());
		target.addEventListener('keydown', listener, true);
		return () => target.removeEventListener('keydown', listener, true);
	}

	subscribe(listener) {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	notify(id) {
		this.emit({type: 'state', id});
	}

	notifyAll() {
		this.emit({type: 'state', id: null});
	}

	emit(change) {
		for (const listener of this.listeners) {
			listener(change);
		}
	}
}
