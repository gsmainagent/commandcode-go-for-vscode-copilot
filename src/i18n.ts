import vscode from 'vscode';

/**
 * Lightweight i18n module — zero dependencies, follows VS Code display language.
 *
 *  - en / en-US / en-*      → English (default)
 *  - zh-cn                  → Simplified Chinese
 *  - all other locales      → English until translated
 */

function isZh(): boolean {
	const lang = vscode.env.language.toLowerCase();
	return lang === 'zh-cn';
}

// ---- Translation dictionaries ----

type Translations = Record<string, string>;

const zh: Translations = {
	// Auth
	'auth.apiKeyRequiredDetail': '请先配置 API Key',
	'auth.prompt': '请输入 Command Code API Key。',
	'auth.placeholder': 'cmd-... 或服务商令牌',
	'auth.emptyValidation': 'API Key 不能为空',
	'auth.saved': 'API Key 已安全保存。',
	'auth.removed': 'API Key 已移除。',
	'auth.notConfigured': 'API Key 未配置，请在命令面板运行 "Command Code Go: 设置 API Key"。',

	// Thinking Effort — short labels for model picker dropdown
	'status.thinking': '思考模式',
	'thinking.none': '停用',
	'thinking.none.desc': '停用思考，响应更快',
	'thinking.low': '轻量',
	'thinking.low.desc': '轻量推理，适合快速编辑和简单任务',
	'thinking.medium': '标准',
	'thinking.medium.desc': '推荐日常使用',
	'thinking.high': '深度',
	'thinking.high.desc': '深度推理，适合复杂任务',

	// Models
	'models.refreshSucceeded': '已从 Command Code Go 套餐页刷新 {0} 个模型。',
	'models.refreshFailed': '拉取模型列表失败：{0}',
	'models.empty': '没有可用的模型。请检查 API Key，或调整模型黑名单设置。',
	'models.fetchRequiresKey': '需要先配置 API Key 才能拉取模型列表。',

	// Capabilities
	'capability.vision': '视觉',
	'capability.reasoning': '推理',
	'tooltip.capabilities': '能力',
	'tooltip.modelId': '模型 ID',
	'model.intelligence': '智能指数',
	'model.price': '价格',
	'model.priceInput': '输入',
	'model.priceOutput': '输出',
	'model.priceCacheRead': '缓存读',
	'model.priceCacheWrite': '缓存写',
	'model.pricePerMTokens': '/ 百万 tokens',
	'model.pricePeak': '高峰',
	'model.pricePeakWindow': '高峰时段',
	'model.priceOffPeakHours': '非高峰 {0} 小时/天',
	'model.priceFree': '免费',
	'tooltip.contextLength': '上下文',
	'model.quota': '请求额度',
	'model.quotaPerFiveHours': '每 5 小时',
	'model.quotaPerWeek': '每周',
	'model.quotaPerMonth': '每月',

	// Model taglines — the curated registry stores these keys so the
	// translations stay in one place and can be corrected in either language.
	'model.detail.qwen3-6-max-preview': '氛围编程与高效智能体执行',
	'model.detail.qwen3-6-plus': '智能体编程与推理',
	'model.detail.qwen3-7-flash': '快速低成本的智能体编程与推理',
	'model.detail.qwen3-7-max': '前沿编程与长周期智能体执行',
	'model.detail.qwen3-7-plus': '智能体编程与推理，成本更低',
	'model.detail.qwen3-8-max': '自主长周期编程与专业工作',
	'model.detail.qwen3-8-27b': '高性价比的 27B 视觉与推理',
	'model.detail.deepseek-v4-flash': '快速混合注意力推理',
	'model.detail.deepseek-v4-pro': '混合注意力长上下文推理',
	'model.detail.muse-spark-1-2-contributor': 'Muse Spark 1.2，约 95% 折扣',
	'model.detail.minimax-m2-5': '跨平台全栈智能体开发',
	'model.detail.minimax-m2-7': '端到端软件工程智能体',
	'model.detail.minimax-m3': '前沿编程、智能体与原生多模态',
	'model.detail.kimi-k2-5': '多模态前端编程',
	'model.detail.kimi-k2-6': '带视觉的长周期编程',
	'model.detail.kimi-k2-7-code': '增强的长周期编程，支持视觉',
	'model.detail.kimi-k2-7-code-highspeed': '高速长周期编程，支持视觉',
	'model.detail.kimi-k3': '长周期编程与知识工作，100 万上下文',
	'model.detail.nemotron-3-ultra-550b-a55b': '开放推理模型，面向长周期自主智能体',
	'model.detail.gpt-5-6-luna': '为成本敏感型负载优化',
	'model.detail.laguna-s-2-1-free': '开放权重的智能体编程与长周期工作',
	'model.detail.step-3-5-flash': '快速稀疏 MoE 智能体推理',
	'model.detail.step-3-7-flash': '多模态稀疏 MoE 推理',
	'model.detail.hy3-paid': '稀疏 MoE 推理与智能体工具调用',
	'model.detail.inkling': '多模态 MoE 推理',
	'model.detail.inkling-small': '轻量 MoE 推理，成本与延迟更低',
	'model.detail.grok-4-5': '编程、智能体任务与知识工作的最强模型',
	'model.detail.mimo-v2-5': '高效长上下文智能体编程',
	'model.detail.mimo-v2-5-pro': '高能力长上下文智能体编程',
	'model.detail.glm-5': '多模态思考与长程规划',
	'model.detail.glm-5-1': '长周期自主编程智能体',
	'model.detail.glm-5-2': '强大编程，100 万上下文，适合长周期任务',
	'model.detail.glm-5-2-fast': '高吞吐 GLM-5.2，100 万上下文',
	'model.detail.glm-5-3': '前沿编程，100 万上下文',

	// Request

	// Errors
	'error.http.400': '[{0}] 请求体格式错误。{1}',
	'error.http.401':
		'[{0}] API Key 错误，认证失败。请检查您的 API Key 是否正确。如果没有 API key，请前往 Studio 创建。',
	'error.http.401.withCreateApiKeyLink':
		'[{0}] API Key 错误，认证失败。请检查您的 API Key 是否正确。如果没有 API key，请前往 [Studio]({1}) 创建。',
	'error.http.403':
		'[{0}] Command Code Go 访问被拒绝。请运行 command-code login，并确认账户已启用 Go 计划。',
	'error.http.403.withUpgradeLink':
		'[{0}] Command Code Go 访问被拒绝。请运行 command-code login，并确认账户已启用 Go 计划。查看 [套餐]({1})。',
	'error.http.422': '[{0}] 请求体参数错误（{1}）。请检查模型 ID、参数或 ZDR 设置。',
	'error.http.429': '[{0}] 请求速率过高。请稍后重试。',
	'error.http.500': '[{0}] 服务器内部故障。请稍后重试。',
	'error.http.503': '[{0}] 服务器负载过高。请稍后重试。',
	'error.http.generic': '[{0}] 服务返回错误响应：{1}',
	'error.action.createApiKey': '创建 API Key',
	'error.action.viewPricing': '套餐详情',
	'error.network.dns': '[{0}] DNS 解析失败。请检查网络连接、防火墙或代理设置。',
	'error.network.unreachable': '[{0}] 目标不可达或拒绝连接。请检查代理服务、网络连接或防火墙设置。',
	'error.network.interrupted': '[{0}] 连接被中断。请检查网络连接、防火墙或代理设置，或稍后重试。',
	'error.network.timeout': '[{0}] 连接超时。请稍后重试，或检查网络连接、防火墙或代理设置。',
	'error.network.tls': '[{0}] TLS/证书校验失败。请检查代理或证书配置。',
	'error.network.aborted':
		'[{0}] 请求已中止。如果不是主动取消，请检查网络连接或代理设置，或稍后重试。',
	'error.network.protocol': '[{0}] HTTP 连接或响应解析失败。请检查代理设置或服务响应。',
	'error.network.configuration': '[{0}] 请求配置无效。请检查扩展设置。',
	'error.network.generic': '[{0}] 网络请求失败。请检查网络连接、防火墙或代理设置。',
	'error.unknown': 'Command Code 请求失败：{0}',

	// Extension
	'extension.activateFailed': 'Command Code Go 扩展激活失败，请查看日志。',
	'extension.welcomeFailed': '欢迎流程执行失败。',
	'extension.deactivateFailed': '停用 Command Code Go 扩展时出错。',
};

const en: Translations = {
	// Auth
	'auth.apiKeyRequiredDetail': 'Configure your API key to enable this model',
	'auth.prompt': 'Enter your Command Code API key.',
	'auth.placeholder': 'cmd-... or provider token',
	'auth.emptyValidation': 'API key cannot be empty',
	'auth.saved': 'API key saved securely.',
	'auth.removed': 'API key removed.',
	'auth.notConfigured':
		'API key not configured. Run "Command Code Go: Set API Key" from the command palette.',

	// Thinking Effort — short labels for model picker dropdown
	'status.thinking': 'Thinking effort',
	'thinking.none': 'Off',
	'thinking.none.desc': 'Disable thinking, fastest responses',
	'thinking.low': 'Light',
	'thinking.low.desc': 'Light reasoning for quick edits and simple tasks',
	'thinking.medium': 'Standard',
	'thinking.medium.desc': 'Recommended for everyday use',
	'thinking.high': 'Deep',
	'thinking.high.desc': 'Deep reasoning for complex tasks',

	// Models
	'models.refreshSucceeded': 'Refreshed {0} models from the Command Code Go plan page.',
	'models.refreshFailed': 'Failed to refresh models: {0}',
	'models.empty': 'No models are available. Check your API key or model blacklist.',
	'models.fetchRequiresKey': 'Set an API key before refreshing the model list.',

	// Capabilities
	'capability.vision': 'Vision',
	'capability.reasoning': 'Reasoning',
	'tooltip.capabilities': 'Capabilities',
	'tooltip.modelId': 'Model ID',
	'model.intelligence': 'Intelligence',
	'model.price': 'Price',
	'model.priceInput': 'input',
	'model.priceOutput': 'output',
	'model.priceCacheRead': 'cache read',
	'model.priceCacheWrite': 'cache write',
	'model.pricePerMTokens': '/M tokens',
	'model.pricePeak': 'peak',
	'model.pricePeakWindow': 'Peak window',
	'model.priceOffPeakHours': '{0}h/day off-peak',
	'model.priceFree': 'Free',
	'tooltip.contextLength': 'Context',
	'model.quota': 'Request allowances',
	'model.quotaPerFiveHours': 'per 5 hours',
	'model.quotaPerWeek': 'per week',
	'model.quotaPerMonth': 'per month',

	// Model taglines — keys must match the ones in `models.ts`.
	'model.detail.qwen3-6-max-preview': 'vibe coding & efficient agent execution',
	'model.detail.qwen3-6-plus': 'agentic coding & reasoning',
	'model.detail.qwen3-7-flash': 'fast low-cost agentic coding & reasoning',
	'model.detail.qwen3-7-max': 'frontier coding & long-horizon agent execution',
	'model.detail.qwen3-7-plus': 'agentic coding & reasoning at lower cost',
	'model.detail.qwen3-8-max': 'autonomous long-horizon coding & professional work',
	'model.detail.qwen3-8-27b': 'cost-efficient 27B vision & reasoning',
	'model.detail.deepseek-v4-flash': 'fast hybrid-attention reasoning',
	'model.detail.deepseek-v4-pro': 'hybrid-attention long-context reasoning',
	'model.detail.muse-spark-1-2-contributor': 'Muse Spark 1.2 at ~95% off',
	'model.detail.minimax-m2-5': 'cross-platform full-stack agentic dev',
	'model.detail.minimax-m2-7': 'end-to-end software engineering agent',
	'model.detail.minimax-m3': 'frontier coding, agents & native multimodality',
	'model.detail.kimi-k2-5': 'multimodal frontend coding',
	'model.detail.kimi-k2-6': 'long-horizon coding with vision',
	'model.detail.kimi-k2-7-code': 'improved long-horizon coding with vision',
	'model.detail.kimi-k2-7-code-highspeed': 'high-speed long-horizon coding with vision',
	'model.detail.kimi-k3': 'long-horizon coding & knowledge work with 1M context',
	'model.detail.nemotron-3-ultra-550b-a55b':
		'open reasoning model for long-horizon autonomous agents',
	'model.detail.gpt-5-6-luna': 'optimized for cost-sensitive workloads',
	'model.detail.laguna-s-2-1-free': 'open-weight agentic coding and long-horizon work',
	'model.detail.step-3-5-flash': 'fast sparse-MoE agentic reasoning',
	'model.detail.step-3-7-flash': 'multimodal sparse-MoE reasoning',
	'model.detail.hy3-paid': 'sparse-MoE reasoning & agentic tool use',
	'model.detail.inkling': 'multimodal MoE reasoning',
	'model.detail.inkling-small': 'lightweight MoE reasoning at lower cost and latency',
	'model.detail.grok-4-5': 'smartest model for coding, agentic tasks, knowledge work',
	'model.detail.mimo-v2-5': 'efficient long-context agentic coding',
	'model.detail.mimo-v2-5-pro': 'high-capability long-context agentic coding',
	'model.detail.glm-5': 'multi-mode thinking & long-range planning',
	'model.detail.glm-5-1': 'long-horizon autonomous coding agent',
	'model.detail.glm-5-2': 'powerful coding with 1M context and long-horizon tasks',
	'model.detail.glm-5-2-fast': 'high-throughput GLM-5.2 with 1M context',
	'model.detail.glm-5-3': 'frontier coding with 1M context',

	// Errors
	'error.http.400': '[{0}] Malformed request body. {1}',
	'error.http.401':
		"[{0}] Authentication failed. Check your Command Code API key. Create one in Studio if you don't have one yet.",
	'error.http.401.withCreateApiKeyLink':
		"[{0}] Authentication failed. Check your Command Code API key. Create one in [Studio]({1}) if you don't have one yet.",
	'error.http.403':
		'[{0}] Command Code Go access was denied. Run command-code login and verify that your account has the Go plan.',
	'error.http.403.withUpgradeLink':
		'[{0}] Command Code Go access was denied. Run command-code login and verify that your account has the Go plan. See [plans]({1}).',
	'error.http.422':
		'[{0}] Invalid request parameters ({1}). Check the model ID, parameters, or ZDR setting.',
	'error.http.429': '[{0}] Rate limit exceeded. Try again in a moment.',
	'error.http.500': '[{0}] Internal server error. Try again later.',
	'error.http.503': '[{0}] Service is overloaded. Try again later.',
	'error.http.generic': '[{0}] The service returned an error: {1}',
	'error.action.createApiKey': 'Create API key',
	'error.action.viewPricing': 'Pricing',
	'error.network.dns': '[{0}] DNS lookup failed. Check your network, firewall, and proxy.',
	'error.network.unreachable':
		'[{0}] The endpoint is unreachable or refused the connection. Check your proxy, network, and firewall.',
	'error.network.interrupted':
		'[{0}] The connection was interrupted. Check your network, firewall, or proxy, or retry shortly.',
	'error.network.timeout':
		'[{0}] The connection timed out. Retry shortly, or check your network, firewall, and proxy.',
	'error.network.tls':
		'[{0}] TLS / certificate validation failed. Check your proxy and certificates.',
	'error.network.aborted':
		'[{0}] Request aborted. If you did not cancel it, check your network or proxy, or retry shortly.',
	'error.network.protocol':
		'[{0}] HTTP connection or response parsing failed. Check your proxy or the service response.',
	'error.network.configuration':
		'[{0}] Invalid request configuration. Check the extension settings.',
	'error.network.generic': '[{0}] Network request failed. Check your network, firewall, and proxy.',
	'error.unknown': 'Command Code request failed: {0}',

	// Extension
	'extension.activateFailed': 'Command Code Go extension failed to activate; see logs for details.',
	'extension.welcomeFailed': 'Welcome walkthrough failed.',
	'extension.deactivateFailed': 'Failed to deactivate Command Code Go extension cleanly.',
};

export function t(key: string, ...args: unknown[]): string {
	const dict = isZh() ? zh : en;
	const template = dict[key] ?? en[key] ?? key;
	if (args.length === 0) {
		return template;
	}
	return template.replace(/\{(\d+)\}/g, (_match, index: string) => {
		const i = Number(index);
		return i < args.length ? String(args[i]) : '';
	});
}
