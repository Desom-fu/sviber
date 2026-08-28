import assert from "node:assert/strict";
import test from "node:test";
import { PREFERENCES_KEY, loadPreferences, storePreferences } from "../js/app/app-helpers.js";
import { AudioPlayer } from "../js/audio/player.js";

function memoryStorage(initial = {}) {
	const values = new Map(Object.entries(initial));
	return {
		getItem: key => values.get(key) ?? null,
		setItem: (key, value) => values.set(key, value),
	};
}

// v18 raises the music volume ceiling to 2 so it matches the SE volume.
test("music volume and SE volume both clamp to 2", () => {
	const stored = storePreferences({ seVolume: 2.5, musicVolume: 2.5 }, memoryStorage());
	assert.equal(stored.seVolume, 2);
	assert.equal(stored.musicVolume, 2);
	const loaded = loadPreferences(
		memoryStorage({
			[PREFERENCES_KEY]: JSON.stringify({ seVolume: 2, musicVolume: 1.5 }),
		}),
	);
	assert.equal(loaded.seVolume, 2);
	assert.equal(loaded.musicVolume, 1.5);
	const player = new AudioPlayer();
	player.setMusicVolume(1.5);
	assert.equal(player.musicVolume, 1.5);
	player.setMusicVolume(2.5);
	assert.equal(player.musicVolume, 2);
	player.setSeVolume(2.5);
	assert.equal(player.seVolume, 2);
	player.setMusicVolume(-1);
	assert.equal(player.musicVolume, 0);
});
