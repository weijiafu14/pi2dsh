import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'

export default function unsupportedFixture(pi: ExtensionAPI): void {
  pi.registerShortcut('ctrl+x', {
    description: 'Terminal-only behavior',
    handler: () => undefined,
  })
  pi.on('future_event' as never, () => undefined)
}
