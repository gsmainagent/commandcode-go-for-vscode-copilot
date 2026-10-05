/**
 * Compile-time constants shared across the extension.
 *
 * These do NOT depend on the VS Code runtime (no workspace configuration,
 * no secrets API). For run-time settings reads see `config.ts`.
 */

/** VS Code configuration section prefix for all extension settings. */
export const CONFIG_SECTION = 'commandcode-copilot';

export const EXTERNAL_URLS = {
	commandcode: {
		apiKeys: 'https://commandcode.ai/docs/studio#api-keys',
		studio: 'https://commandcode.ai/studio/',
		pricing: 'https://commandcode.ai/docs/resources/pricing-limits',
	},
} as const;

/** URI path handled by this extension to reveal the output log. */
export const SHOW_LOGS_URI_PATH = '/showLogs';

/** URI path handled by this extension to open API key configuration. */
export const CONFIGURE_API_KEY_URI_PATH = '/setApiKey';

/** URI path handled by this extension to refresh the model list. */
export const REFRESH_MODELS_URI_PATH = '/refreshModels';

// VS Code's internal LanguageModelChatMessageRole.System is not exposed in @types/vscode.
export const LANGUAGE_MODEL_CHAT_SYSTEM_ROLE = 3;

// ---- Secret keys ----

/** SecretStorage key for the Command Code API key. */
export const API_KEY_SECRET = 'commandcode-copilot.apiKey';

/** memento key tracking whether the welcome walkthrough has been shown. */
export const WELCOME_SHOWN_KEY = 'commandcode-copilot.welcomeShown';

// ---- Walkthrough ----

/** Walkthrough contribution ID. */
export const WALKTHROUGH_ID =
	'hotrungnhan.command-code-go-for-github-copilot#commandcodeGettingStarted';

// ---- Provider defaults ----

/** Default Command Code Generate API base URL (the `/alpha/generate` surface). */
export const DEFAULT_BASE_URL = 'https://api.commandcode.ai/alpha';

/**
 * Default catalog base URL — the OpenAI-compatible surface that serves
 * `GET /models`.
 *
 * This is deliberately NOT the Generate API host: `/alpha/*` exposes no model
 * listing at all (every candidate route answers 404), so the catalog has to come
 * from `/provider/v1`. It is consulted only for canonical model ids — the plan
 * page supplies the list, names, and capabilities.
 */
export const DEFAULT_CATALOG_BASE_URL = 'https://api.commandcode.ai/provider/v1';

/**
 * Base URL of the plan documentation pages. The extension targets the Go plan
 * only, so the slug is fixed rather than configurable.
 *
 * This page is the authoritative model list: it states what the plan includes,
 * each model's display name and context window, and its capabilities in the
 * `Caps` column (`Capabilities: Text input, Vision, Reasoning`). The API
 * catalog spans every plan and cannot express any of that.
 */
export const DEFAULT_PLAN_BASE_URL = 'https://commandcode.ai/docs/plans';

/**
 * Base URL of the CLI reference pages, whose model table lists canonical ids
 * (`moonshotai/Kimi-K3`) as the CLI itself addresses them.
 *
 * This is the supported id source on the Go plan. `/provider/v1/models` also
 * serves ids, but the Provider API is documented as unavailable to Go
 * subscribers and only its GET is ungated, so it cannot be relied on. Together
 * with the compiled registry this page resolves all but one of the Go plan's
 * models.
 */
export const DEFAULT_CLI_REFERENCE_BASE_URL = 'https://commandcode.ai/docs/reference/cli';

/** The only plan this extension supports. */
export const SUPPORTED_PLAN = 'go';

/**
 * Minutes before a stored catalog snapshot is refetched.
 *
 * Short enough that a newly listed model shows up within a work session without
 * an extension update, long enough that repeat picker queries stay free.
 */
export const DEFAULT_CATALOG_REFRESH_MINUTES = 30;

/**
 * Command Code's current CLI protocol version. The API requires a CLI-version
 * header even when the caller is this VS Code extension.
 */
export const COMMAND_CODE_CLIENT_VERSION = '1.28.1';

/** Vendor ID exposed to GitHub Copilot Chat. */
export const VENDOR_ID = 'commandcode';

/** Family identifier used for chat info. */
export const FAMILY = 'commandcode';
