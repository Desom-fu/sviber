import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import { composeTraits, installTraitMembers } from "../js/core/mixin.js";

// The editor layers are assembled by copying member descriptors from trait classes onto one
// composed prototype. An ES `#private` member is brand-checked against the class that declared
// it, so a copied method that calls one throws
// "TypeError: Receiver must be an instance of class X" the moment a user triggers it. That is
// exactly what broke Edit > Checks..., Timing > Adjust offset, both Attach to curve commands and
// Automatic timing in v0.8.2, so trait modules must use `_`-prefixed prototype methods instead.
const TRAIT_DIRECTORIES = ["../js/app", "../js/render"];

test("composed traits can call their own helpers on the composed instance", () => {
	class Trait {
		publicEntry() {
			return this._helper() + 1;
		}

		_helper() {
			return 41;
		}
	}
	const Composed = composeTraits("Layer", Trait)(class {});
	assert.equal(new Composed().publicEntry(), 42);
	assert.equal(Composed.name, "Layer");
	// A composed member must not be enumerable, exactly like a real class method.
	assert.deepEqual(Object.keys(Composed.prototype), []);
});

test("a trait helper declared #private breaks once its members are copied", () => {
	class Broken {
		entry() {
			return this.#helper();
		}

		#helper() {
			return 1;
		}
	}
	class Target {}
	installTraitMembers(Target.prototype, Broken.prototype);
	// This is the failure mode the rule below exists to prevent, pinned here so the reason the
	// rule exists stays visible.
	assert.throws(() => new Target().entry(), TypeError);
	// The same method still works on an instance of its declaring class.
	assert.equal(new Broken().entry(), 1);
});

test("no module that composes traits declares private members", async () => {
	const offenders = [];
	for (const directory of TRAIT_DIRECTORIES) {
		const base = new URL(`${directory}/`, import.meta.url);
		for (const name of await readdir(base)) {
			if (!name.endsWith(".js")) {
				continue;
			}
			const source = await readFile(new URL(name, base), "utf8");
			// Only modules whose members are copied onto another prototype are affected;
			// a plain class elsewhere (a WebGL surface, an index structure) may use
			// `#private` freely. A trait module either composes its own layer or exports a
			// `Trait` class for another module to install.
			if (!/composeTraits|installTraitMembers|export class w*Trait/.test(source)) {
				continue;
			}
			if (/^\t#[A-Za-z_]/m.test(source) || /this\.#/.test(source)) {
				offenders.push(`${directory}/${name}`);
			}
		}
	}
	assert.deepEqual(offenders, []);
});
