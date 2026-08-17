import {i18n as defaultI18n} from './i18n.js';
import {clearElement, nextControlId, resolveElement} from './ui-shared.js';
import {createFieldControl, MIXED_VALUE} from './ui-fields.js';

export function wireSideTabs(documentRef = globalThis.document) {
	const inspectorTab = documentRef?.getElementById('inspector-tab');
	const snappeesTab = documentRef?.getElementById('snappees-tab');
	const inspectorPanel = documentRef?.getElementById('inspector-panel');
	const snappeesPanel = documentRef?.getElementById('snappees-panel');
	if (!inspectorTab || !snappeesTab || !inspectorPanel || !snappeesPanel) {
		return () => {};
	}
	if (inspectorTab.dataset.tabsWired === 'true') {
		return () => {};
	}
	inspectorTab.dataset.tabsWired = 'true';
	const activate = target => {
		const inspectorActive = target === 'inspector';
		inspectorTab.classList.toggle('is-active', inspectorActive);
		snappeesTab.classList.toggle('is-active', !inspectorActive);
		inspectorTab.setAttribute('aria-selected', String(inspectorActive));
		snappeesTab.setAttribute('aria-selected', String(!inspectorActive));
		inspectorPanel.hidden = !inspectorActive;
		snappeesPanel.hidden = inspectorActive;
	};
	const inspect = () => activate('inspector');
	const snap = () => activate('snappees');
	inspectorTab.addEventListener('click', inspect);
	snappeesTab.addEventListener('click', snap);
	return () => {
		inspectorTab.removeEventListener('click', inspect);
		snappeesTab.removeEventListener('click', snap);
		delete inspectorTab.dataset.tabsWired;
	};
}

function deepEqual(left, right) {
	if (Object.is(left, right)) return true;
	try {
		return JSON.stringify(left) === JSON.stringify(right);
	} catch {
		return false;
	}
}

export class InspectorPanel {
	constructor(options = {}) {
		this.document = options.document || globalThis.document;
		this.i18n = options.i18n || defaultI18n;
		this.tooltip = options.tooltip || null;
		this.element = resolveElement(options.element, 'inspector-panel', this.document);
		this.controls = [];
		if (!this.element) throw new Error('InspectorPanel requires an inspector panel element');
		this.unwireTabs = wireSideTabs(this.document);
		this.unsubscribeLanguage = this.i18n.subscribe(() => this.rerender());
		this.clear();
	}

	clear(messageKey = 'panel.noSelection') {
		this.destroyControls();
		clearElement(this.element);
		const empty = this.document.createElement('div');
		empty.className = 'empty-panel';
		empty.textContent = this.i18n.t(messageKey);
		this.element.appendChild(empty);
		this.lastRender = {empty: messageKey};
	}

	render(groupsOrFields = [], options = {}) {
		this.destroyControls();
		clearElement(this.element);
		const groups = groupsOrFields.length && groupsOrFields[0]?.fields
			? groupsOrFields
			: [{labelKey: options.groupLabelKey || 'panel.properties', fields: groupsOrFields}];
		if (!groups.some(group => group.fields?.length)) {
			this.clear(options.emptyKey || 'panel.noSelection');
			return;
		}
		this.lastRender = {groupsOrFields, options};
		for (const group of groups) {
			const fieldset = this.document.createElement('fieldset');
			fieldset.className = 'property-group';
			if (group.labelKey || group.label) {
				const legend = this.document.createElement('legend');
				legend.textContent = group.labelKey ? this.i18n.t(group.labelKey) : String(group.label);
				fieldset.appendChild(legend);
			}
			for (const field of group.fields || []) {
				const row = this.document.createElement('div');
				row.className = 'property-row';
				const label = this.document.createElement('label');
				label.textContent = field.labelKey ? this.i18n.t(field.labelKey) : String(field.label || field.id);
				const control = createFieldControl(field, field.value ?? null, {
					document: this.document,
					i18n: this.i18n,
					onChange: () => {
						const value = control.read();
						options.onChange?.(field.id, value, field);
					}
				});
				const input = control.element.matches?.('input, select, textarea')
					? control.element
					: control.element.querySelector?.('input, select, textarea');
				if (input) {
					input.id ||= nextControlId('inspector-field');
					label.htmlFor = input.id;
				}
				const disabled = typeof field.disabled === 'function' ? field.disabled(options.context) : field.disabled;
				control.setDisabled(Boolean(disabled));
				if (field.tooltipKey || field.tooltip) {
					this.tooltip?.register(label, field.tooltipKey || field.tooltip, {raw: Boolean(field.tooltip && !field.tooltipKey)});
				}
				row.append(label, control.element);
				fieldset.appendChild(row);
				this.controls.push({control, label});
			}
			this.element.appendChild(fieldset);
		}
	}

	setSelection(items, schema, options = {}) {
		if (!items?.length) {
			this.clear();
			return;
		}
		const source = typeof schema === 'function' ? schema(items) : schema;
		const groups = source?.[0]?.fields ? source : [{labelKey: 'panel.commonProperties', fields: source || []}];
		const renderedGroups = groups.map(group => ({
			...group,
			fields: (group.fields || []).map(field => {
				const getter = field.get || (item => item?.[field.id]);
				const first = getter(items[0]);
				const common = items.every(item => deepEqual(getter(item), first));
				return {...field, value: common ? first : MIXED_VALUE};
			})
		}));
		this.render(renderedGroups, {
			...options,
			onChange: (id, value, field) => options.onChange?.({id, value, field, items})
		});
	}

	destroyControls() {
		for (const {control, label} of this.controls) {
			control.destroy?.();
			this.tooltip?.unregister(label);
		}
		this.controls.length = 0;
	}

	rerender() {
		if (!this.lastRender) return;
		if (this.lastRender.empty) {
			this.clear(this.lastRender.empty);
		} else {
			this.render(this.lastRender.groupsOrFields, this.lastRender.options);
		}
	}

	destroy() {
		this.destroyControls();
		this.unsubscribeLanguage?.();
		this.unwireTabs?.();
	}
}

function drawSnappeePreview(canvas, item) {
	const ratio = Math.max(1, globalThis.devicePixelRatio || 1);
	canvas.width = 24 * ratio;
	canvas.height = 24 * ratio;
	canvas.style.width = '24px';
	canvas.style.height = '24px';
	const context = canvas.getContext('2d');
	if (!context) return;
	context.scale(ratio, ratio);
	context.clearRect(0, 0, 24, 24);
	context.strokeStyle = item.color || '#50a226';
	context.fillStyle = item.color || '#50a226';
	context.lineWidth = 1.5;
	context.globalAlpha = item.active === false ? 0 : 0.95;
	const type = item.type || '';
	if (type.includes('rectangular') || type.includes('parametricMesh')) {
		for (const coordinate of [5, 12, 19]) {
			context.beginPath(); context.moveTo(coordinate, 3); context.lineTo(coordinate, 21); context.stroke();
			context.beginPath(); context.moveTo(3, coordinate); context.lineTo(21, coordinate); context.stroke();
		}
	} else if (type.includes('radial')) {
		for (const radius of [4, 8]) {
			context.beginPath(); context.arc(12, 12, radius, 0, Math.PI * 2); context.stroke();
		}
		for (let index = 0; index < 6; index++) {
			const angle = index * Math.PI / 3;
			context.beginPath(); context.moveTo(12, 12);
			context.lineTo(12 + Math.cos(angle) * 10, 12 + Math.sin(angle) * 10); context.stroke();
		}
	} else if (type.includes('regularPolygon')) {
		context.beginPath();
		for (let index = 0; index < 6; index++) {
			const angle = index * Math.PI / 3 - Math.PI / 2;
			const x = 12 + Math.cos(angle) * 9;
			const y = 12 + Math.sin(angle) * 9;
			index ? context.lineTo(x, y) : context.moveTo(x, y);
		}
		context.closePath(); context.stroke();
	} else if (type.includes('circular')) {
		context.beginPath(); context.arc(12, 12, 9, Math.PI * 0.25, Math.PI * 1.75); context.stroke();
	} else {
		context.beginPath();
		context.moveTo(2, 17);
		context.bezierCurveTo(7, 2, 15, 22, 22, 7);
		context.stroke();
		for (const point of [[2, 17], [9, 9], [16, 15], [22, 7]]) {
			context.beginPath(); context.arc(point[0], point[1], 1.4, 0, Math.PI * 2); context.fill();
		}
	}
}

function drawActionIcon(canvas, type) {
	const ratio = Math.max(1, globalThis.devicePixelRatio || 1);
	canvas.width = 17 * ratio;
	canvas.height = 17 * ratio;
	canvas.style.width = '17px';
	canvas.style.height = '17px';
	const context = canvas.getContext('2d');
	if (!context) return;
	context.scale(ratio, ratio);
	context.strokeStyle = 'currentColor';
	context.lineWidth = 1.6;
	if (type === 'duplicate') {
		context.strokeRect(2.5, 5.5, 9, 9);
		context.strokeRect(5.5, 2.5, 9, 9);
	} else {
		context.beginPath();
		context.moveTo(4, 4); context.lineTo(13, 13);
		context.moveTo(13, 4); context.lineTo(4, 13);
		context.stroke();
	}
}

export class SnappeesPanel {
	constructor(options = {}) {
		this.document = options.document || globalThis.document;
		this.i18n = options.i18n || defaultI18n;
		this.tooltip = options.tooltip || null;
		this.element = resolveElement(options.element, 'snappees-panel', this.document);
		this.callbacks = {
			onSelect: options.onSelect,
			onToggle: options.onToggle,
			onDuplicate: options.onDuplicate,
			onDelete: options.onDelete,
			onEdit: options.onEdit
		};
		this.items = [];
		this.selectedId = null;
		this.registeredElements = [];
		if (!this.element) throw new Error('SnappeesPanel requires a snappees panel element');
		this.unwireTabs = wireSideTabs(this.document);
		this.unsubscribeLanguage = this.i18n.subscribe(() => this.render());
		this.render();
	}

	setCallbacks(callbacks = {}) {
		Object.assign(this.callbacks, callbacks);
	}

	setItems(items = [], options = {}) {
		this.items = items;
		if (Object.hasOwn(options, 'selectedId')) this.selectedId = options.selectedId;
		this.render();
	}

	select(id, notify = true) {
		this.selectedId = id;
		this.render();
		if (notify) this.callbacks.onSelect?.(id, this.items.find(item => item.id === id) || null);
	}

	clearSelection(notify = true) {
		this.select(null, notify);
	}

	createAction(item, tooltipKey, iconType, callback) {
		const button = this.document.createElement('button');
		button.type = 'button';
		button.className = 'snappee-action';
		if (iconType === 'activate' || iconType === 'deactivate') {
			const image = this.document.createElement('img');
			image.src = `maker/svg/icons/${iconType}-snappee.svg`;
			image.alt = '';
			image.draggable = false;
			button.appendChild(image);
		} else {
			const canvas = this.document.createElement('canvas');
			drawActionIcon(canvas, iconType);
			button.appendChild(canvas);
		}
		button.setAttribute('aria-label', this.i18n.t(tooltipKey));
		this.tooltip?.register(button, tooltipKey);
		this.registeredElements.push(button);
		button.addEventListener('click', event => {
			event.stopPropagation();
			callback?.(item);
		});
		return button;
	}

	render() {
		for (const element of this.registeredElements) this.tooltip?.unregister(element);
		this.registeredElements.length = 0;
		clearElement(this.element);
		if (!this.items.length) {
			const empty = this.document.createElement('div');
			empty.className = 'empty-panel';
			empty.textContent = this.i18n.t('panel.noSnappees');
			this.element.appendChild(empty);
			return;
		}
		for (const item of this.items) {
			const row = this.document.createElement('div');
			row.className = 'snappee-item';
			row.classList.toggle('is-selected', item.id === this.selectedId);
			row.tabIndex = 0;
			row.setAttribute('role', 'button');
			row.setAttribute('aria-pressed', String(item.id === this.selectedId));
			row.title = this.i18n.t('panel.snappee.edit');
			const preview = this.document.createElement('div');
			preview.className = 'snappee-preview';
			if (typeof item.renderPreview === 'function') {
				item.renderPreview(preview, item);
			} else {
				const canvas = this.document.createElement('canvas');
				drawSnappeePreview(canvas, item);
				preview.appendChild(canvas);
			}
			const name = this.document.createElement('span');
			name.className = 'snappee-name';
			name.textContent = item.name || `${this.i18n.t(`snappee.${item.type}`)} ${item.id}`;
			row.append(preview, name);
			row.append(
				this.createAction(
					item,
					item.active === false ? 'panel.snappee.activate' : 'panel.snappee.deactivate',
					item.active === false ? 'activate' : 'deactivate',
					selected => this.callbacks.onToggle?.(selected, selected.active === false)
				),
				this.createAction(item, 'panel.snappee.duplicate', 'duplicate', selected => this.callbacks.onDuplicate?.(selected)),
				this.createAction(item, 'panel.snappee.delete', 'delete', selected => this.callbacks.onDelete?.(selected))
			);
			row.addEventListener('click', () => {
				if (item.active !== false) this.select(item.id);
			});
			row.addEventListener('dblclick', event => {
				event.preventDefault();
				this.callbacks.onEdit?.(item);
			});
			row.addEventListener('keydown', event => {
				if (event.key === 'Enter' || event.key === ' ') {
					event.preventDefault();
					item.active === false ? this.callbacks.onToggle?.(item, true) : this.select(item.id);
				} else if (event.key === 'Escape' && this.selectedId != null) {
					event.preventDefault();
					this.clearSelection();
				}
			});
			this.element.appendChild(row);
		}
	}

	destroy() {
		for (const element of this.registeredElements) this.tooltip?.unregister(element);
		this.unsubscribeLanguage?.();
		this.unwireTabs?.();
	}
}

function formatHistoryTime(value) {
	if (!value) return '';
	if (typeof value === 'string') return value;
	const date = value instanceof Date ? value : new Date(value);
	if (Number.isNaN(date.getTime())) return '';
	return date.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit', second: '2-digit'});
}

export class HistoryPanel {
	constructor(options = {}) {
		this.document = options.document || globalThis.document;
		this.i18n = options.i18n || defaultI18n;
		this.tooltip = options.tooltip || null;
		this.element = resolveElement(options.element, 'history-list', this.document);
		this.capacity = options.capacity ?? 1000;
		this.onSeek = options.onSeek || null;
		this.items = [];
		this.pointer = -1;
		this.registeredElements = [];
		if (!this.element) throw new Error('HistoryPanel requires a history list element');
		this.unsubscribeLanguage = this.i18n.subscribe(() => this.render());
	}

	set(items = [], pointer = items.length - 1) {
		const overflow = Math.max(0, items.length - this.capacity);
		this.items = items.slice(overflow);
		this.pointer = Math.max(-1, Math.min(this.items.length - 1, pointer - overflow));
		this.render();
	}

	append(item, options = {}) {
		if (this.pointer < this.items.length - 1) {
			this.items.splice(this.pointer + 1);
		}
		this.items.push({...item, time: item.time || Date.now()});
		if (this.items.length > this.capacity) this.items.shift();
		this.pointer = options.current === false ? this.pointer : this.items.length - 1;
		this.render({scrollCurrent: true});
	}

	setPointer(pointer, options = {}) {
		this.pointer = Math.max(-1, Math.min(this.items.length - 1, pointer));
		this.render({scrollCurrent: options.scrollCurrent !== false});
	}

	seek(pointer) {
		if (pointer < 0 || pointer >= this.items.length || pointer === this.pointer) return;
		const item = this.items[pointer];
		const accepted = this.onSeek?.(pointer, item);
		if (accepted !== false) this.setPointer(pointer);
	}

	labelFor(item) {
		if (item.labelKey) return this.i18n.t(item.labelKey, item.params || {});
		return String(item.label || item.name || '');
	}

	render(options = {}) {
		for (const element of this.registeredElements) this.tooltip?.unregister(element);
		this.registeredElements.length = 0;
		clearElement(this.element);
		let currentElement = null;
		this.items.forEach((item, index) => {
			const button = this.document.createElement('button');
			button.type = 'button';
			button.className = 'history-item';
			button.classList.toggle('is-current', index === this.pointer);
			button.classList.toggle('is-future', index > this.pointer);
			button.setAttribute('aria-current', index === this.pointer ? 'step' : 'false');
			const indexElement = this.document.createElement('span');
			indexElement.className = 'history-index';
			indexElement.textContent = String(index + 1);
			const name = this.document.createElement('span');
			name.textContent = this.labelFor(item);
			const time = this.document.createElement('span');
			time.className = 'history-time';
			time.textContent = formatHistoryTime(item.time);
			button.append(indexElement, name, time);
			button.addEventListener('click', () => this.seek(index));
			this.tooltip?.register(button, 'panel.history.seek');
			this.registeredElements.push(button);
			this.element.appendChild(button);
			if (index === this.pointer) currentElement = button;
		});
		if (options.scrollCurrent) currentElement?.scrollIntoView({block: 'nearest'});
	}

	destroy() {
		for (const element of this.registeredElements) this.tooltip?.unregister(element);
		this.unsubscribeLanguage?.();
	}
}
