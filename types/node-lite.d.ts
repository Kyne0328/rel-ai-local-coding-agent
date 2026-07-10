declare module 'node:*' {
  const value: any;
  export = value;
}

declare function require(id: string): any;
declare const __dirname: string;
declare const process: {
  argv: string[];
  env: Record<string, string | undefined>;
  execPath: string;
  platform: string;
  exitCode?: number;
};
