// A minimal Pi provider standing in for a private gateway: it declares the
// compat quirks and reasoning levels that DSH's own settings path cannot
// carry, and points at the local fake endpoint so the wire can be inspected.
//
// Each declaration below maps to a reported symptom:
//   supportsDeveloperRole: false  → gateways that reject `developer`
//   maxTokensField                → gateways that only accept one spelling
//   supportsStore: false          → gateways that reject `store`
//   thinkingLevelMap              → a model whose levels differ from default
//   input: ['text','image']       → a custom provider offering vision
import { createProvider } from '@earendil-works/pi-ai'
import { openAICompletionsApi } from '@earendil-works/pi-ai/compat'

const BASE = process.env.PROBE_BASE_URL ?? 'http://127.0.0.1:4599/v1'

export default function (pi) {
  const provider = createProvider({
    id: 'probe',
    name: 'Probe Gateway',
    baseUrl: BASE,
    auth: {
      apiKey: {
        name: 'Probe API key',
        resolve: async () => ({ auth: { apiKey: 'probe-key' } }),
      },
    },
    models: [{
      id: 'probe-model',
      name: 'Probe Model',
      provider: 'probe',
      api: 'openai-completions',
      baseUrl: BASE,
      reasoning: true,
      // `minimal` is unsupported here; `xhigh` exists only because it is
      // declared. Neither can be expressed through DSH settings.
      thinkingLevelMap: {
        minimal: null,
        low: 'low',
        medium: 'medium',
        high: 'high',
        xhigh: 'xhigh',
      },
      input: ['text', 'image'],
      cost: { input: 0, output: 0 },
      contextWindow: 128000,
      maxTokens: 4096,
      compat: {
        supportsDeveloperRole: false,
        maxTokensField: 'max_completion_tokens',
        supportsStore: false,
      },
    }],
    api: { 'openai-completions': openAICompletionsApi() },
  })
  pi.registerProvider(provider)
}
