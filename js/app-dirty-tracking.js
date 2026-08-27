// Saved/dirty tracking. A chart counts as modified when the part of it that a save would
// persist differs from the signature recorded at the last save; the project is dirty when
// any difficulty is. Split out of app-core.js.

// Selection and editor view state are excluded so moving the playhead or picking an event
// never marks a chart dirty.
function persistedSignature(model) {
	const snapshot = model.snapshot();
	delete snapshot.editor;
	for (const event of snapshot.events || []) {
		delete event.selected;
	}
	for (const snappee of snapshot.snappees || []) {
		delete snappee.selected;
	}
	return JSON.stringify(snapshot);
}

export const withDirtyTracking = Base =>
	class extends Base {
		modelSignature(model = this.model) {
			return persistedSignature(model);
		}

		markProjectSaved() {
			this.syncActiveDifficultyState();
			for (const entry of this.difficulties) {
				entry.savedSignature = this.modelSignature(entry.model);
			}
			this.savedSignature = this.activeDifficultyState()?.savedSignature ?? this.modelSignature();
			this.projectDirty = false;
			this.dirty = false;
		}

		// Saving only the active chart leaves the other difficulties to decide dirtiness.
		markSaved() {
			this.savedSignature = this.modelSignature();
			this.syncActiveDifficultyState();
			const active = this.activeDifficultyState();
			this.dirty =
				this.projectDirty ||
				this.difficulties.some(
					entry => entry !== active && this.modelSignature(entry.model) !== entry.savedSignature,
				);
		}

		updateDirty() {
			this.syncActiveDifficultyState();
			this.dirty =
				this.projectDirty ||
				this.difficulties.some(entry => this.modelSignature(entry.model) !== entry.savedSignature);
			return this.dirty;
		}
	};
