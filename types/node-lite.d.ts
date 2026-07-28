declare module 'node:url' {
  export function fileURLToPath(value: string | URL): string;
  export function pathToFileURL(value: string): URL;
}

declare module 'node:*' {
  const value: any;
  export = value;
}

declare const process: {
  argv: string[];
  env: Record<string, string | undefined>;
  execPath: string;
  platform: string;
  exitCode?: number;
  resourcesPath?: string;
};
