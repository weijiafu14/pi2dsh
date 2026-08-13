export interface Component {
  render(width: number): string[]
  invalidate?(): void
  handleInput?(data: string): void
}

export class Text implements Component {
  constructor(public text = '', public paddingX = 0, public paddingY = 0) {}
  render(width: number): string[] {
    const pad = ' '.repeat(this.paddingX)
    const lines = this.text.split('\n').map(line => `${pad}${truncateToWidth(line, Math.max(0, width - this.paddingX * 2))}${pad}`)
    return [...Array.from({ length: this.paddingY }, () => ''), ...lines, ...Array.from({ length: this.paddingY }, () => '')]
  }
  setText(text: string): void { this.text = text }
  invalidate(): void {}
}

export class Spacer extends Text {
  constructor(lines = 1) { super('\n'.repeat(Math.max(0, lines - 1))) }
}

export class Container implements Component {
  children: Component[] = []
  addChild(child: Component): void { this.children.push(child) }
  removeChild(child: Component): void { this.children = this.children.filter(candidate => candidate !== child) }
  clear(): void { this.children = [] }
  render(width: number): string[] { return this.children.flatMap(child => child.render(width)) }
  invalidate(): void { for (const child of this.children) child.invalidate?.() }
}

export class Markdown extends Text {}

export class Editor extends Text {
  getText(): string { return this.text }
  setText(text: string): void { this.text = text }
  handleInput(_data: string): void {}
}

export class SelectList extends Container {}

export const CURSOR_MARKER = ''

type KeyFactory = (key: string) => string
interface KeyShim extends Record<string, string | KeyFactory> {
  ctrl: KeyFactory
  shift: KeyFactory
  alt: KeyFactory
  super: KeyFactory
  ctrlShift: KeyFactory
  shiftCtrl: KeyFactory
  ctrlAlt: KeyFactory
  altCtrl: KeyFactory
  shiftAlt: KeyFactory
  altShift: KeyFactory
  ctrlSuper: KeyFactory
  superCtrl: KeyFactory
  shiftSuper: KeyFactory
  superShift: KeyFactory
  altSuper: KeyFactory
  superAlt: KeyFactory
  ctrlShiftAlt: KeyFactory
  ctrlShiftSuper: KeyFactory
}

const modifier = (...names: string[]): KeyFactory => key => `${names.join('+')}+${key}`
const keyFactories = {
  ctrl: modifier('ctrl'),
  shift: modifier('shift'),
  alt: modifier('alt'),
  super: modifier('super'),
  ctrlShift: modifier('ctrl', 'shift'),
  shiftCtrl: modifier('shift', 'ctrl'),
  ctrlAlt: modifier('ctrl', 'alt'),
  altCtrl: modifier('alt', 'ctrl'),
  shiftAlt: modifier('shift', 'alt'),
  altShift: modifier('alt', 'shift'),
  ctrlSuper: modifier('ctrl', 'super'),
  superCtrl: modifier('super', 'ctrl'),
  shiftSuper: modifier('shift', 'super'),
  superShift: modifier('super', 'shift'),
  altSuper: modifier('alt', 'super'),
  superAlt: modifier('super', 'alt'),
  ctrlShiftAlt: modifier('ctrl', 'shift', 'alt'),
  ctrlShiftSuper: modifier('ctrl', 'shift', 'super'),
}

export const Key: KeyShim = new Proxy(keyFactories as KeyShim, {
  get: (target, property) => Reflect.get(target, property) ?? String(property),
})

export function matchesKey(data: string, key: string | readonly string[]): boolean {
  return Array.isArray(key) ? key.includes(data) : data === key
}

export function decodeKittyPrintable(data: string): string { return data }

export function truncateToWidth(text: string, width: number): string {
  if (width <= 0) return ''
  return [...text].slice(0, width).join('')
}

export function wrapTextWithAnsi(text: string, width: number): string[] {
  if (width <= 0) return ['']
  const characters = [...text]
  const lines: string[] = []
  while (characters.length > 0) lines.push(characters.splice(0, width).join(''))
  return lines.length > 0 ? lines : ['']
}

export function fuzzyFilter<T>(items: readonly T[]): T[] { return [...items] }
