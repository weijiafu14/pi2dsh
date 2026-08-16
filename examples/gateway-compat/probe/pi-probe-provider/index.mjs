// Minimal Pi provider declaring the compat field DSH's own config layer drops.
// Points at the local fake endpoint so the wire can be inspected.
import { createProvider } from '@earendil-works/pi-ai'
import { openAICompletionsApi } from '@earendil-works/pi-ai/compat'

const BASE = 'http://127.0.0.1:4599/v1'

export default function (pi) {
  const provider = createProvider({
    id: 'probe',
    name: 'Probe Gateway',
    baseUrl: BASE,
    auth: {
      apiKey: {
        name: 'Probe API key',
        // Pi resolves the key per request through this seam.
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
      input: ['text'],
      cost: { input: 0, output: 0 },
      contextWindow: 128000,
      maxTokens: 4096,
      // The whole point: a private gateway that does NOT accept `developer`.
      compat: { supportsDeveloperRole: false },
    }],
    api: { 'openai-completions': openAICompletionsApi() },
  })
  pi.registerProvider(provider)
}
