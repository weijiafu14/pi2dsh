// A minimal catalog-only Pi provider standing in for a private gateway. It
// brings NO transport: pi2dsh translates this declaration into rc.8's official
// llm-pi-ai profile, and DSH assembles the request whose wire we inspect.
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
const BASE = process.env.PROBE_BASE_URL ?? 'http://127.0.0.1:4599/v1'

export default function (pi) {
  pi.registerProvider('probe', {
    id: 'probe',
    name: 'Probe Gateway',
    api: 'openai-completions',
    baseUrl: BASE,
    // Pi's standard $ENV reference becomes DSH's apiKeyEnv credential ref.
    apiKey: '$PROBE_API_KEY',
    models: [{
      id: process.env.PROBE_MODEL ?? 'deepseek-chat',
      name: 'Probe Model',
      provider: 'probe',
      api: 'openai-completions',
      baseUrl: BASE,
      reasoning: true,
      // `minimal` is unsupported here; canonical `xhigh` deliberately maps
      // to wire-level `high`, so the E2E can prove translation really happened.
      thinkingLevelMap: {
        minimal: null,
        low: 'low',
        medium: 'medium',
        high: 'high',
        xhigh: 'high',
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
  })
}
