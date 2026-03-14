declare module 'stream-json' {
  export function parser(options?: Record<string, unknown>): NodeJS.ReadWriteStream;
}

declare module 'stream-json/filters/Pick' {
  export function pick(options?: Record<string, unknown>): NodeJS.ReadWriteStream;
}

declare module 'stream-json/streamers/StreamArray' {
  export function streamArray(options?: Record<string, unknown>): NodeJS.ReadWriteStream;
}
