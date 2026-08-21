export default function alibabaPlanProbe(pi) {
  pi.registerTool({
    name: 'alibaba_plan_probe',
    label: 'Alibaba Plan Probe',
    description: 'Return a supplied marker so the live example proves a complete tool loop.',
    parameters: {
      type: 'object',
      properties: { value: { type: 'string' } },
      required: ['value'],
      additionalProperties: false,
    },
    async execute(_callId, args) {
      return {
        content: [{ type: 'text', text: `ALIBABA_PLAN_PROBE:${args.value}` }],
        details: { value: args.value },
      }
    },
  })
}
