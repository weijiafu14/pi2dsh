// Headless @earendil-works/pi-tui compatibility surface.
//
// Pure text/measurement/key logic is vendored byte-identical from Pi (see
// ./vendor/PI-LICENSE), so extensions observe identical widths, wrapping,
// key names, fuzzy ranking, and keybinding tables. Interactive component
// classes are headless: identical constructor/method signatures, plain-text
// render output, no terminal I/O. Pi itself defines headless behavior for
// json/print modes (noOpUIContext) and rpc `ui.custom` (undefined); these
// classes exist so extensions can load and construct UI trees without a TTY.

export {
  applyBackgroundToLine,
  cjkBreakRegex,
  extractAnsiCode,
  getGraphemeCellRange,
  getGraphemeSegmenter,
  getOsc8LinkAtColumn,
  getWordSegmenter,
  isPunctuationChar,
  isWhitespaceChar,
  normalizeTerminalOutput,
  PUNCTUATION_REGEX,
  sliceByColumn,
  sliceWithWidth,
  stripTerminalSequences,
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
} from './vendor/pi-tui-utils.js'
export { fuzzyFilter, fuzzyMatch, type FuzzyMatch } from './vendor/pi-tui-fuzzy.js'
export {
  decodeKittyPrintable,
  isKeyRelease,
  isKeyRepeat,
  isKittyProtocolActive,
  Key,
  type KeyEventType,
  type KeyId,
  matchesKey,
  parseKey,
  setKittyProtocolActive,
} from './vendor/pi-tui-keys.js'
export {
  parseOsc11BackgroundColor,
  parseTerminalColorSchemeReport,
  type RgbColor,
  type TerminalColorScheme,
} from './vendor/pi-tui-terminal-colors.js'
export {
  getKeybindings,
  type Keybinding,
  type KeybindingConflict,
  type KeybindingDefinition,
  type KeybindingDefinitions,
  type Keybindings,
  type KeybindingsConfig,
  KeybindingsManager,
  setKeybindings,
  TUI_KEYBINDINGS,
} from './vendor/pi-tui-keybindings.js'
export { renderLatex, type RenderLatexOptions } from './vendor/pi-tui-latex.js'
export {
  allocateImageId,
  calculateImageRows,
  type CellDimensions,
  deleteAllKittyImages,
  deleteKittyImage,
  detectCapabilities,
  encodeITerm2,
  encodeKitty,
  getCapabilities,
  getCellDimensions,
  getGifDimensions,
  getImageDimensions,
  getJpegDimensions,
  getPngDimensions,
  getWebpDimensions,
  hyperlink,
  type ImageDimensions,
  imageFallback,
  type ImageProtocol,
  resetCapabilitiesCache,
  setCapabilities,
  setCellDimensions,
  type TerminalCapabilities,
} from './vendor/pi-tui-terminal-image.js'
export {
  type AutocompleteItem,
  type AutocompleteProvider,
  type AutocompleteSuggestions,
  CombinedAutocompleteProvider,
  type SlashCommand,
} from './vendor/pi-tui-autocomplete.js'
export { Marked, type Token, type Tokens } from 'marked'

import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from './vendor/pi-tui-utils.js'
import type { AutocompleteProvider } from './vendor/pi-tui-autocomplete.js'

// Pi's cursor-position marker: an APC sequence stripped by visibleWidth.
export const CURSOR_MARKER = '\x1b_pi:c\x07'

export interface Component {
  render(width: number): string[]
  invalidate(): void
  handleInput?(data: string): void
  wantsKeyRelease?: boolean
}

export interface Focusable {
  focused: boolean
}

export function isFocusable(value: unknown): value is Focusable {
  return typeof value === 'object' && value !== null && 'focused' in value
}

function blankLines(count: number): string[] {
  return Array.from({ length: Math.max(0, count) }, () => '')
}

export class Container implements Component {
  children: Component[] = []
  addChild(child: Component): void {
    this.children.push(child)
  }
  removeChild(child: Component): void {
    this.children = this.children.filter(candidate => candidate !== child)
  }
  clear(): void {
    this.children = []
  }
  invalidate(): void {
    for (const child of this.children) child.invalidate()
  }
  render(width: number): string[] {
    return this.children.flatMap(child => child.render(width))
  }
}

export class Text implements Component {
  private customBgFn: ((text: string) => string) | undefined
  constructor(
    public text: string = '',
    public paddingX: number = 1,
    public paddingY: number = 1,
    customBgFn?: (text: string) => string,
  ) {
    this.customBgFn = customBgFn
  }
  setText(text: string): void {
    this.text = text
  }
  setCustomBgFn(customBgFn?: (text: string) => string): void {
    this.customBgFn = customBgFn
  }
  invalidate(): void {}
  render(width: number): string[] {
    const pad = ' '.repeat(Math.max(0, this.paddingX))
    const inner = Math.max(1, width - this.paddingX * 2)
    const lines = this.text.split('\n').flatMap(line => wrapTextWithAnsi(line, inner))
    const rendered = lines.map(line => {
      const value = `${pad}${line}${pad}`
      return this.customBgFn === undefined ? value : this.customBgFn(value)
    })
    return [...blankLines(this.paddingY), ...rendered, ...blankLines(this.paddingY)]
  }
}

export class TruncatedText implements Component {
  constructor(
    public text: string,
    public paddingX: number = 0,
    public paddingY: number = 0,
  ) {}
  invalidate(): void {}
  render(width: number): string[] {
    const pad = ' '.repeat(Math.max(0, this.paddingX))
    const inner = Math.max(1, width - this.paddingX * 2)
    const lines = this.text.split('\n').map(line => `${pad}${truncateToWidth(line, inner)}${pad}`)
    return [...blankLines(this.paddingY), ...lines, ...blankLines(this.paddingY)]
  }
}

export class Spacer implements Component {
  constructor(private lines: number = 1) {}
  setLines(lines: number): void {
    this.lines = lines
  }
  invalidate(): void {}
  render(_width: number): string[] {
    return blankLines(this.lines)
  }
}

export class Box implements Component {
  private children: Component[] = []
  private bgFn: ((text: string) => string) | undefined
  constructor(
    public paddingX: number = 1,
    public paddingY: number = 1,
    bgFn?: (text: string) => string,
  ) {
    this.bgFn = bgFn
  }
  addChild(component: Component): void {
    this.children.push(component)
  }
  removeChild(component: Component): void {
    this.children = this.children.filter(candidate => candidate !== component)
  }
  clear(): void {
    this.children = []
  }
  setBgFn(bgFn?: (text: string) => string): void {
    this.bgFn = bgFn
  }
  invalidate(): void {
    for (const child of this.children) child.invalidate()
  }
  render(width: number): string[] {
    const pad = ' '.repeat(Math.max(0, this.paddingX))
    const inner = Math.max(1, width - this.paddingX * 2)
    const lines = this.children.flatMap(child => child.render(inner))
    const rendered = [...blankLines(this.paddingY), ...lines.map(line => `${pad}${line}${pad}`), ...blankLines(this.paddingY)]
    return this.bgFn === undefined ? rendered : rendered.map(line => this.bgFn!(line))
  }
}

export interface MarkdownTheme {
  [key: string]: unknown
}
export interface MarkdownOptions {
  [key: string]: unknown
}
export type DefaultTextStyle = (text: string) => string

export class Markdown implements Component {
  constructor(
    public text: string = '',
    public paddingX: number = 1,
    public paddingY: number = 1,
    private theme?: MarkdownTheme,
    private options?: MarkdownOptions,
  ) {}
  setText(text: string): void {
    this.text = text
  }
  invalidate(): void {}
  render(width: number): string[] {
    const pad = ' '.repeat(Math.max(0, this.paddingX))
    const inner = Math.max(1, width - this.paddingX * 2)
    const lines = this.text.split('\n').flatMap(line => wrapTextWithAnsi(line, inner))
    return [...blankLines(this.paddingY), ...lines.map(line => `${pad}${line}${pad}`), ...blankLines(this.paddingY)]
  }
}

export interface SelectItem {
  value: string
  label: string
  description?: string
}
export interface SelectListTheme {
  selectedPrefix?: unknown
  selectedText?: unknown
  description?: unknown
  scrollInfo?: unknown
  noMatch?: unknown
  [key: string]: unknown
}
export interface SelectListLayoutOptions {
  minPrimaryColumnWidth?: number
  maxPrimaryColumnWidth?: number
  truncatePrimary?: unknown
}
export interface SelectListTruncatePrimaryContext {
  [key: string]: unknown
}

export class SelectList implements Component {
  onSelect?: (item: SelectItem) => void
  onCancel?: () => void
  onSelectionChange?: (item: SelectItem) => void
  private filtered: SelectItem[]
  private selectedIndex = 0
  constructor(
    private items: SelectItem[],
    private maxVisible: number,
    private theme: SelectListTheme,
    private layout: SelectListLayoutOptions = {},
  ) {
    this.filtered = [...items]
  }
  setFilter(filter: string): void {
    const query = filter.toLowerCase()
    this.filtered = this.items.filter(item =>
      item.label.toLowerCase().includes(query) || item.value.toLowerCase().includes(query))
    this.selectedIndex = 0
  }
  setSelectedIndex(index: number): void {
    this.selectedIndex = Math.max(0, Math.min(index, this.filtered.length - 1))
  }
  getSelectedItem(): SelectItem | null {
    return this.filtered[this.selectedIndex] ?? null
  }
  invalidate(): void {}
  handleInput(_keyData: string): void {}
  render(width: number): string[] {
    return this.filtered.slice(0, this.maxVisible)
      .map((item, index) => truncateToWidth(`${index === this.selectedIndex ? '→ ' : '  '}${item.label}`, Math.max(1, width)))
  }
}

export interface SettingItem {
  id: string
  label: string
  description?: string
  currentValue: string
  values?: string[]
  submenu?: (currentValue: string, done: (selectedValue?: string) => void) => Component
}
export interface SettingsListTheme {
  label?: unknown
  value?: unknown
  description?: unknown
  cursor?: unknown
  hint?: unknown
  [key: string]: unknown
}
export interface SettingsListOptions {
  enableSearch?: boolean
}

export class SettingsList implements Component {
  constructor(
    private items: SettingItem[],
    private maxVisible: number,
    private theme: SettingsListTheme,
    private onChange: (id: string, newValue: string) => void,
    private onCancel: () => void,
    private options: SettingsListOptions = {},
  ) {}
  updateValue(id: string, newValue: string): void {
    const item = this.items.find(candidate => candidate.id === id)
    if (item !== undefined) item.currentValue = newValue
  }
  invalidate(): void {}
  handleInput(_data: string): void {}
  render(width: number): string[] {
    return this.items.slice(0, this.maxVisible)
      .map(item => truncateToWidth(`${item.label}: ${item.currentValue}`, Math.max(1, width)))
  }
}

export class Input implements Component, Focusable {
  focused = false
  onSubmit?: (value: string) => void
  onEscape?: () => void
  private value = ''
  getValue(): string {
    return this.value
  }
  setValue(value: string): void {
    this.value = value
  }
  handleInput(data: string): void {
    if (data === '\r' || data === '\n') {
      this.onSubmit?.(this.value)
      return
    }
    if (data === '\x1b') {
      this.onEscape?.()
      return
    }
    if (data >= ' ') this.value += data
  }
  invalidate(): void {}
  render(width: number): string[] {
    return [truncateToWidth(this.value, Math.max(1, width))]
  }
}

export interface EditorTheme {
  borderColor?: (s: string) => string
  selectList?: SelectListTheme
  [key: string]: unknown
}
export interface EditorOptions {
  paddingX?: number
  autocompleteMaxVisible?: number
}

export interface EditorComponent {
  getText(): string
  setText(text: string): void
  handleInput(data: string): void
  onSubmit?: (text: string) => void
  onChange?: (text: string) => void
  addToHistory?(text: string): void
  insertTextAtCursor?(text: string): void
  getExpandedText?(): string
  setAutocompleteProvider?(provider: AutocompleteProvider): void
}

export class Editor implements Component, Focusable, EditorComponent {
  focused = false
  borderColor: (str: string) => string = str => str
  onSubmit?: (text: string) => void
  onChange?: (text: string) => void
  disableSubmit = false
  private text = ''
  private history: string[] = []
  private autocompleteProvider?: AutocompleteProvider
  constructor(
    private tui?: unknown,
    private theme: EditorTheme = {},
    private options: EditorOptions = {},
  ) {}
  getText(): string {
    return this.text
  }
  setText(text: string): void {
    this.text = text
    this.onChange?.(text)
  }
  getExpandedText(): string {
    return this.text
  }
  insertTextAtCursor(text: string): void {
    this.setText(this.text + text)
  }
  addToHistory(text: string): void {
    this.history.push(text)
  }
  setAutocompleteProvider(provider: AutocompleteProvider): void {
    this.autocompleteProvider = provider
  }
  getPaddingX(): number {
    return this.options.paddingX ?? 0
  }
  setPaddingX(padding: number): void {
    this.options.paddingX = padding
  }
  getAutocompleteMaxVisible(): number {
    return this.options.autocompleteMaxVisible ?? 5
  }
  setAutocompleteMaxVisible(maxVisible: number): void {
    this.options.autocompleteMaxVisible = maxVisible
  }
  handleInput(data: string): void {
    if (data === '\r' || data === '\n') {
      if (!this.disableSubmit) this.onSubmit?.(this.text)
      return
    }
    if (data >= ' ') this.setText(this.text + data)
  }
  invalidate(): void {}
  render(width: number): string[] {
    return this.text.split('\n').flatMap(line => wrapTextWithAnsi(line, Math.max(1, width)))
  }
}

export interface StackEntryOptions {
  [key: string]: unknown
}
export type StackChild = Component | { component: Component; options?: StackEntryOptions }
export interface StackEntry {
  component: Component
  options?: StackEntryOptions
}
export interface StackOptions {
  [key: string]: unknown
}

class Stack extends Container {
  constructor(children: StackChild[] = [], protected options: StackOptions = {}) {
    super()
    for (const child of children) {
      this.addChild('component' in child ? child.component : child)
    }
  }
}

export class VStack extends Stack {}

export class HStack extends Stack {
  override render(width: number): string[] {
    const columns = this.children.map(child => child.render(width))
    const height = Math.max(0, ...columns.map(column => column.length))
    const lines: string[] = []
    for (let row = 0; row < height; row += 1) {
      lines.push(columns.map(column => column[row] ?? '').join(' '))
    }
    return lines
  }
}

export interface LoaderIndicatorOptions {
  frames?: string[]
  intervalMs?: number
}

export class Loader extends Text {
  constructor(message = '', indicator?: LoaderIndicatorOptions) {
    super(message, 0, 0)
    void indicator
  }
  start(): void {}
  stop(): void {}
  setMessage(message: string): void {
    this.setText(message)
  }
  setIndicator(_indicator?: LoaderIndicatorOptions): void {}
}

export class CancellableLoader extends Loader {
  onCancel?: () => void
  handleInput(data: string): void {
    if (data === '\x1b' || data === '\x03') this.onCancel?.()
  }
  dispose(): void {}
}

export interface ImageOptions {
  [key: string]: unknown
}
export interface ImageTheme {
  [key: string]: unknown
}

export class Image implements Component {
  constructor(
    private base64Data: string = '',
    private mimeType: string = 'image/png',
    private options: ImageOptions = {},
  ) {}
  getImageId(): number | undefined {
    return undefined
  }
  invalidate(): void {}
  render(width: number): string[] {
    return [truncateToWidth(`[image ${this.mimeType}]`, Math.max(1, width))]
  }
}

export interface ScrollViewScrollbar {
  [key: string]: unknown
}
export interface ScrollViewOptions {
  [key: string]: unknown
}
export interface ScrollViewScrollToOptions {
  [key: string]: unknown
}

export class ScrollView extends Container {
  private scrollTop = 0
  constructor(component: Component, private options: ScrollViewOptions = {}) {
    super()
    this.addChild(component)
  }
  setScrollbar(_scrollbar: ScrollViewScrollbar): void {}
  getContentWidth(width: number): number {
    return Math.max(1, width - 1)
  }
  setScrollbarActive(_active: boolean): void {}
  scrollTo(scrollTop: number, _options: ScrollViewScrollToOptions = {}): void {
    this.scrollTop = Math.max(0, scrollTop)
  }
  scrollBy(lines: number): number {
    this.scrollTop = Math.max(0, this.scrollTop + lines)
    return this.scrollTop
  }
  scrollToStart(): void {
    this.scrollTop = 0
  }
  scrollToEnd(): void {}
  updateLayout(_contentHeight: number, _viewportHeight: number, _requestRender: () => void): void {}
}

export interface OverlayMargin {
  top?: number
  right?: number
  bottom?: number
  left?: number
}
export type SizeValue = number | `${number}%`
export interface OverlayAnchor {
  [key: string]: unknown
}
export interface OverlayOptions {
  width?: SizeValue
  maxHeight?: SizeValue
  anchor?: OverlayAnchor
  margin?: OverlayMargin
  [key: string]: unknown
}
export interface OverlayUnfocusOptions {
  [key: string]: unknown
}
export interface OverlayHandle {
  close(): void
  [key: string]: unknown
}
export type TuiMode = 'regular' | 'fullscreen'
export interface TuiStopOptions {
  preserveScreen?: boolean
}
export type TuiInputListenerResult = { consume?: boolean; data?: string } | undefined
export type TuiInputListener = (data: string) => TuiInputListenerResult

export interface TUI extends Component {
  addChild(child: Component): void
  removeChild(child: Component): void
  clear(): void
  setFocus(component: Component | null): void
  showOverlay(component: Component, options?: OverlayOptions): OverlayHandle
  hideOverlay(): void
  hasOverlay(): boolean
  requestRender(): void
  [key: string]: unknown
}
export interface ViewportTUI extends TUI {
  [key: string]: unknown
}
export function isViewportTUI(value: unknown): value is ViewportTUI {
  return false
}
