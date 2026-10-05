import vscode from 'vscode';
import { t } from '../i18n';
import type {
	ModelDefinition,
	PlanPricing,
	PlanQuota,
	ReasoningEffort,
	ThinkingCapability,
	ThinkingEffort,
} from '../types';
import { getMaxContextTokensOverride } from '../config';

/**
 * Non-public Copilot Chat API surface.
 *
 * `isBYOK`, `isUserSelectable`, `statusIcon`, and `configurationSchema` are
 * not yet in `@types/vscode` — they are the same shape currently consumed
 * by GitHub Copilot Chat to render model-picker metadata and per-model
 * configuration controls. The fields are exposed here so the extension can
 * continue to work against the proposed API surface.
 */
export type ModelConfigurationOptions = vscode.ProvideLanguageModelChatResponseOptions & {
	readonly modelConfiguration?: Record<string, unknown>;
	readonly configuration?: Record<string, unknown>;
};

type ThinkingEffortConfigurationSchema = ReturnType<typeof buildThinkingEffortSchema>;

export type ModelPickerChatInformation = vscode.LanguageModelChatInformation & {
	readonly isUserSelectable: boolean;
	readonly isBYOK: true;
	readonly statusIcon?: vscode.ThemeIcon;
	readonly configurationSchema?: ThinkingEffortConfigurationSchema;
};

export function toChatInfo(m: ModelDefinition, hasApiKey: boolean): ModelPickerChatInformation {
	const thinkingCapability = m.capabilities.thinking;
	const contextOverride = getMaxContextTokensOverride();

	// Precedence for the window reported to Copilot: an explicit
	// `maxContextTokens` setting wins, otherwise the value derived from the
	// live catalog (or the static registry as fallback) stands.
	const maxInputTokens = contextOverride > 0 ? contextOverride : m.maxInputTokens;

	return {
		id: m.id,
		name: m.name,
		family: m.family,
		version: m.version,
		detail: hasApiKey ? modelTagline(m) : t('auth.apiKeyRequiredDetail'),
		tooltip: hasApiKey ? formatTooltip(m) : t('auth.apiKeyRequiredDetail'),
		statusIcon: hasApiKey ? undefined : new vscode.ThemeIcon('warning'),
		maxInputTokens,
		maxOutputTokens: m.maxOutputTokens,
		isBYOK: true,
		isUserSelectable: true,
		capabilities: {
			toolCalling: m.capabilities.toolCalling,
			imageInput: m.capabilities.imageInput,
		},
		...(thinkingCapability
			? { configurationSchema: buildThinkingEffortSchema(thinkingCapability) }
			: {}),
	};
}

/**
 * Resolve a model's picker tagline in the display language.
 *
 * The curated registry stores `detailKey` rather than text so the strings live
 * in the two dictionaries in `i18n.ts` and can be corrected in either language.
 * `src/models.ts` cannot do the lookup itself because `i18n.ts` imports the VS
 * Code API, which the unit tests covering that module do not provide.
 *
 * A missing key yields no tagline rather than the raw key: `t()` falls back to
 * the key itself, which would put `model.detail.gpt-5-6-luna` in front of a user.
 */
function modelTagline(m: ModelDefinition): string | undefined {
	if (m.detailKey) {
		const translated = t(m.detailKey);
		return translated === m.detailKey ? undefined : translated;
	}
	return m.detail;
}

/**
 * Build the hover tooltip card shown by Copilot Chat's model picker.
 *
 * Everything here comes from the plan page, so a model whose metadata could not
 * be read simply shows less rather than showing something invented. Sections are
 * omitted when empty; no placeholder dashes are rendered, because a dash on the
 * docs page means "not supported", not "unknown".
 *
 * Off-peak and peak prices never split the model into two entries — there is one
 * name per model. The peak rate and its window are described here instead.
 */
function formatTooltip(m: ModelDefinition): string {
	const sections: string[] = [];

	const tagline = modelTagline(m);
	if (tagline) {
		sections.push(tagline);
	}

	const facts: string[] = [];
	if (m.intelligence !== undefined) {
		facts.push(`${t('model.intelligence')} ${m.intelligence}`);
	}
	if (m.capabilities.imageInput) {
		facts.push(t('capability.vision'));
	}
	if (m.capabilities.thinking) {
		facts.push(t('capability.reasoning'));
	}
	if (facts.length > 0) {
		sections.push(facts.join(' · '));
	}

	const price = formatPricing(m.pricing);
	if (price) {
		sections.push(price);
	}

	const quota = formatQuota(m.quota);
	if (quota) {
		sections.push(quota);
	}

	if (m.fetched) {
		sections.push(`${t('tooltip.modelId')}: ${m.id}`);
	}

	return sections.join('\n\n');
}

/**
 * Render the plan page's request allowances.
 *
 * Only shown when the page's quota table listed this model. It covers 41 of the
 * 53 models on the Go plan, so an absent allowance means the page stated
 * nothing — rendering `0` would claim the model is unusable, which is a different
 * claim entirely.
 *
 * Counts keep the thousands separators the page prints, and fractional figures
 * are not rounded: three models state `64.7` and `93.3` where every other row is
 * whole, and those are real per-window counts rather than thousands.
 */
function formatQuota(quota: PlanQuota | undefined): string | undefined {
	if (!quota) {
		return undefined;
	}
	return [
		t('model.quota'),
		`${t('model.quotaPerFiveHours')}: ${formatRequestCount(quota.perFiveHours)}`,
		`${t('model.quotaPerWeek')}: ${formatRequestCount(quota.perWeek)}`,
		`${t('model.quotaPerMonth')}: ${formatRequestCount(quota.perMonth)}`,
	].join('\n');
}

/** Group digits so a four-figure allowance is not read as a bare number. */
function formatRequestCount(value: number): string {
	return value.toLocaleString('en-US', { maximumFractionDigits: 1 });
}

/**
 * Render the plan page's price table.
 *
 * All figures are USD per million tokens. A rate of exactly zero means the model
 * is free, which the page also states outright; `undefined` means the page did
 * not say, and that column is left out entirely.
 */
function formatPricing(pricing: PlanPricing | undefined): string | undefined {
	if (!pricing) {
		return undefined;
	}

	const rates: Array<readonly [string, number | undefined, number | undefined]> = [
		[t('model.priceInput'), pricing.input, pricing.peakInput],
		[t('model.priceOutput'), pricing.output, pricing.peakOutput],
		[t('model.priceCacheRead'), pricing.cacheRead, pricing.peakCacheRead],
		[t('model.priceCacheWrite'), pricing.cacheWrite, undefined],
	];

	const rows: string[] = [];
	for (const [label, offPeak, peak] of rates) {
		if (offPeak === undefined) {
			continue;
		}
		if (offPeak === 0) {
			rows.push(`${label}: ${t('model.priceFree')}`);
			continue;
		}
		const base = `$${formatRate(offPeak)}${t('model.pricePerMTokens')}`;
		rows.push(
			peak !== undefined && peak !== offPeak
				? `${base} (${t('model.pricePeak')} $${formatRate(peak)})`
				: base,
		);
	}

	if (rows.length === 0) {
		return undefined;
	}

	const notes: string[] = [];
	if (pricing.offPeakHoursPerDay !== undefined) {
		notes.push(t('model.priceOffPeakHours', pricing.offPeakHoursPerDay));
	}
	if (pricing.peakWindow) {
		notes.push(`${t('model.pricePeakWindow')}: ${pricing.peakWindow}`);
	}

	const heading = `${t('model.price')} ${t('model.pricePerMTokens')}`;
	return notes.length > 0
		? `${heading}\n${rows.join('\n')}\n${notes.join(' · ')}`
		: `${heading}\n${rows.join('\n')}`;
}

/** Trim trailing zeros so `1.50` reads as `$1.5` and `0.016` keeps its precision. */
function formatRate(value: number): string {
	const rounded = Math.round(value * 1_000_000) / 1_000_000;
	return String(rounded);
}

export function getConfiguredThinkingEffort(
	options: ModelConfigurationOptions,
	thinkingCapability: ThinkingCapability,
): ThinkingEffort {
	const configuredEffort =
		options.modelConfiguration?.reasoningEffort ?? options.configuration?.reasoningEffort;

	if (configuredEffort === 'none' && thinkingCapability.canDisable) {
		return 'none';
	}

	if (isSupportedReasoningEffort(configuredEffort, thinkingCapability)) {
		return configuredEffort;
	}

	return thinkingCapability.defaultEffort;
}

function buildThinkingEffortSchema(thinkingCapability: ThinkingCapability) {
	const efforts: ThinkingEffort[] = [
		...(thinkingCapability.canDisable ? (['none'] as const) : []),
		...thinkingCapability.supportedEfforts,
	];

	return {
		properties: {
			reasoningEffort: {
				type: 'string',
				title: t('status.thinking'),
				enum: efforts,
				enumItemLabels: efforts.map((effort) => t(`thinking.${effort}`)),
				enumDescriptions: efforts.map((effort) => t(`thinking.${effort}.desc`)),
				default: thinkingCapability.defaultEffort,
				group: 'navigation',
			},
		},
	} as const;
}

function isSupportedReasoningEffort(
	value: unknown,
	thinkingCapability: ThinkingCapability,
): value is ReasoningEffort {
	return thinkingCapability.supportedEfforts.some((effort) => effort === value);
}
