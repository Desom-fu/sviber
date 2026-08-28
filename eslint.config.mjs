// Lint configuration required by PROMPT-v17: linting errors out when a file exceeds
// 1000 lines, a function exceeds 100 lines, a line holds more than one statement, a
// line is longer than 120 characters, two function definitions are not separated by an
// empty line, an `if` or `for` clause omits its curly braces, or a ternary operator
// spans multiple lines.

const sharedRules = {
	"max-lines": ["error", { max: 1000, skipBlankLines: false, skipComments: false }],
	"max-lines-per-function": ["error", { max: 100, skipBlankLines: false, skipComments: false, IIFEs: true }],
	"max-statements-per-line": ["error", { max: 1 }],
	"max-len": ["error", { code: 120, tabWidth: 4, ignoreUrls: true, ignoreRegExpLiterals: true }],
	"lines-between-class-members": ["error", "always", { exceptAfterSingleLine: false }],
	"padding-line-between-statements": ["error", { blankLine: "always", prev: "function", next: "function" }],
	curly: ["error", "all"],
	"multiline-ternary": ["error", "never"],
};

export default [
	{
		ignores: [
			"node_modules/**",
			"build/**",
			"assets/**",
			"test-results/**",
			"js/audio/audio-decode.bundle.js",
			"js/macro/macro-api.rb",
		],
	},
	{
		files: ["**/*.js", "**/*.mjs", "**/*.cjs"],
		languageOptions: {
			ecmaVersion: "latest",
			sourceType: "module",
			globals: {
				globalThis: "readonly",
				window: "readonly",
				document: "readonly",
				navigator: "readonly",
				location: "readonly",
				localStorage: "readonly",
				performance: "readonly",
				console: "readonly",
				fetch: "readonly",
				URL: "readonly",
				Blob: "readonly",
				File: "readonly",
				FileReader: "readonly",
				Worker: "readonly",
				Image: "readonly",
				AudioContext: "readonly",
				requestAnimationFrame: "readonly",
				cancelAnimationFrame: "readonly",
				setTimeout: "readonly",
				clearTimeout: "readonly",
				setInterval: "readonly",
				clearInterval: "readonly",
				queueMicrotask: "readonly",
				structuredClone: "readonly",
				process: "readonly",
				Buffer: "readonly",
				require: "readonly",
				module: "writable",
				__dirname: "readonly",
				JSZip: "readonly",
				math: "readonly",
				nw: "readonly",
				monaco: "readonly",
			},
		},
		linterOptions: { reportUnusedDisableDirectives: true },
		rules: sharedRules,
	},
	{
		files: ["js/cli/cli-main.js", "scripts/**/*.cjs"],
		languageOptions: { sourceType: "commonjs" },
		rules: sharedRules,
	},
];
