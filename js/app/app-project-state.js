// Project-level state that every difficulty shares: the artist metadata and the media
// paths, mirrored across all charts and across their history stacks. Chart titles stay
// per-chart. Split out of app-core.js so this mirroring is described in one place.

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
		// difficulty (and onto itself, since it may have just been swapped in). Titles are
		// per-chart and are not mirrored here.
		syncProjectSharedFields() {
			for (const entry of this.difficulties) {
				entry.model.metadata.artist = this.projectArtist;
			}
			this.model.metadata.artist = this.projectArtist;
			this.model.music = this.projectMusic;
			this.model.image = this.projectImage;
		}

		// Undoing inside one difficulty must not resurrect a stale project artist in another,
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
						state.metadata.artist = this.projectArtist;
					}
					return state;
				});
			}
		}

		restoreHistorySnapshot(snapshot) {
			const artist = String(snapshot.metadata?.artist ?? this.projectArtist);
			const artistChanged = artist !== this.projectArtist;
			this.model.restore(snapshot);
			this.projectMusic = String(this.model.music || "");
			this.projectImage = String(this.model.image || "");
			this._normalizeGroupSelectionScope();
			this._invalidatePlaybackSchedule();
			if (artistChanged) {
				this.projectArtist = artist;
				this.syncProjectHistorySharedFields({ excludeDifficultyId: this.activeDifficultyId, media: false });
			}
			this.syncProjectSharedFields();
			if (!this.audio?.playing && typeof this.audio?.seek === "function") {
				this.audio.seek(this.currentSeconds());
			}
		}
	};
