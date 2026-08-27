// Prototype composition helpers for the layered app/stage classes.
//
// The editor is assembled from many small behaviour layers that are applied to a base
// class one after another. Writing each layer as `Base => class extends Base { ... }`
// makes the whole layer body a single function, which collides with the lint budget of
// 100 lines per function even when the individual methods are short. Declaring the
// layer as a plain module-level "trait" class and copying its prototype members into
// the subclass keeps the factory tiny, lets one layer be assembled from several trait
// classes living in different modules, and preserves the prototype chain (and therefore
// `instanceof`, overriding and method lookup order) exactly as `extends` would.

const SKIPPED_MEMBERS = new Set(["constructor"]);

// Copies the own members of `source` (a trait prototype or a plain method table) onto
// `prototype`, keeping getters and setters intact and matching the non-enumerability of
// real class members.
export function installTraitMembers(prototype, source) {
	const descriptors = Object.getOwnPropertyDescriptors(source);
	for (const name of Object.keys(descriptors)) {
		if (SKIPPED_MEMBERS.has(name)) {
			delete descriptors[name];
			continue;
		}
		descriptors[name].enumerable = false;
	}
	Object.defineProperties(prototype, descriptors);
	return prototype;
}

function traitSource(trait) {
	return typeof trait === "function" ? trait.prototype : trait;
}

// Builds a mixin factory: `withThing = composeTraits("ThingLayer", ThingTrait, ...)`.
// The returned factory takes the base class and yields a subclass carrying every trait
// member, so callers keep the familiar `withThing(Base)` shape.
export function composeTraits(name, ...traits) {
	return Base => {
		const Layer = class extends Base {};
		Object.defineProperty(Layer, "name", { value: name, configurable: true });
		for (const trait of traits) {
			installTraitMembers(Layer.prototype, traitSource(trait));
		}
		return Layer;
	};
}
