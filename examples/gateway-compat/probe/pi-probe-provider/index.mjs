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
//
// PROBE_BASE_URL points at the recording proxy, which forwards to a REAL
// upstream — nothing here is mocked; the proxy only writes down what was sent.
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
        // The real upstream credential, from the environment — the proxy
        // forwards it untouched and never stores it. Point PROBE_API_KEY_ENV
        // at whatever variable holds your gateway's key.
        resolve: async () => ({
          auth: { apiKey: process.env[process.env.PROBE_API_KEY_ENV ?? 'DEEPSEEK_API_KEY'] ?? '' },
        }),
      },
    },
    models: [{
      id: process.env.PROBE_MODEL ?? 'deepseek-chat',
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
        // Deliberately the NON-default spelling. Declaring the default one
        // ('max_completion_tokens', which is what goes out when nothing is
        // declared) made the assertion unfalsifiable: it passed whether or not
        // the declaration was honoured. Verified against the real
        // pi-provider-litellm, whose Moonshot models declare this same value.
        maxTokensField: 'max_tokens',
        supportsStore: false,
      },
    }],
    api: { 'openai-completions': openAICompletionsApi() },
  })
  pi.registerProvider(provider)
}
