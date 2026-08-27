// Project-level state that every difficulty shares: the title/artist metadata and the media
// paths, mirrored across all charts and across their history stacks. Split out of
// app-core.js so this mirroring is described in one place.

export const withProjectState = Base =>
	class extends Base {
		projectSnapshot() {
			this.syncActiveDifficultyState();
			return {
				name: this.projectName || this.model.metadata.title,
				activeChart: this.activeDifficultyId,
				charts: this.difficulties.map(entry => ({ id: entry.id, file: entry.file, model: entry.model })),
			};
		}

		// Shared fields live on the project, so the active chart pushes them onto every
		// difficulty (and onto itself, since it may have just been swapped in).
		syncProjectSharedFields() {
			for (const entry of this.difficulties) {
				entry.model.metadata.title = this.projectTitle;
				entry.model.metadata.artist = this.projectArtist;
			}
			this.model.metadata.title = this.projectTitle;
			this.model.metadata.artist = this.projectArtist;
			this.model.music = this.projectMusic;
			this.model.image = this.projectImage;
		}

		// Undoing inside one difficulty must not resurrect a stale project title in another,
		// so the shared fields are rewritten through every recorded history state too.
		syncProjectHistorySharedFields(options = {}) {
			const excludeDifficultyId = options.excludeDifficultyId ?? null;
			const metadata = options.metadata !== false;
			for (const entry of this.difficulties) {
				if (entry.id === excludeDifficultyId) {
					continue;
				}
				entry.history.transformStates(state => {
					if (metadata) {
						state.metadata.title = this.projectTitle;
						state.metadata.artist = this.projectArtist;
					}
					return state;
				});
			}
		}

		restoreHistorySnapshot(snapshot) {
			const title = String(snapshot.metadata?.title ?? this.projectTitle);
			const artist = String(snapshot.metadata?.artist ?? this.projectArtist);
			const metadataChanged = title !== this.projectTitle || artist !== this.projectArtist;
			this.model.restore(snapshot);
			this.projectMusic = String(this.model.music || "");
			this.projectImage = String(this.model.image || "");
			this._normalizeGroupSelectionScope();
			this._invalidatePlaybackSchedule();
			if (metadataChanged) {
				this.projectTitle = title;
				this.projectArtist = artist;
				this.projectName = title;
				this.syncProjectHistorySharedFields({ excludeDifficultyId: this.activeDifficultyId, media: false });
			}
			this.syncProjectSharedFields();
			if (!this.audio?.playing && typeof this.audio?.seek === "function") {
				this.audio.seek(this.currentSeconds());
			}
		}
	};
