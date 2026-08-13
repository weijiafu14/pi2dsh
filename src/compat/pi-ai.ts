export interface StringEnumOptions<T extends readonly string[]> {
  description?: string
  default?: T[number]
}

export function StringEnum<T extends readonly string[]>(
  values: T,
  options: StringEnumOptions<T> = {},
): { type: 'string'; enum: T; description?: string; default?: T[number] } {
  return {
    type: 'string',
    enum: values,
    ...(options.description !== undefined ? { description: options.description } : {}),
    ...(options.default !== undefined ? { default: options.default } : {}),
  }
}
