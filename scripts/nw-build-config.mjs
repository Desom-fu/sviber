export const PACKAGED_WINDOW_ICON = "sviber/icon.png";

const BUILDER_ICONS = {
	win: "sviber/icon.ico",
	osx: "sviber/icon.icns",
	linux: "sviber/icon.png",
};

export function builderApplicationOptions(platform, packageJson) {
	const normalizedPlatform = platform === "win32" ? "win" : platform === "darwin" ? "osx" : platform;
	const name = String(packageJson.name || "sviber");
	const version = String(packageJson.version || "0.0.0");
	const application = {
		name,
		icon: BUILDER_ICONS[normalizedPlatform] || BUILDER_ICONS.linux,
	};
	if (normalizedPlatform !== "osx") {
		return application;
	}
	return {
		...application,
		LSApplicationCategoryType: "public.app-category.music",
		CFBundleIdentifier: "io.github.desomfu.sviber",
		CFBundleName: name,
		CFBundleDisplayName: name,
		CFBundleSpokenName: name,
		CFBundleVersion: version,
		CFBundleShortVersionString: version,
		NSHumanReadableCopyright: "Copyright (c) sviber contributors",
	};
}
