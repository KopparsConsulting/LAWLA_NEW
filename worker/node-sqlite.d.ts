/** Minimal typning av Nodes inbyggda SQLite, bara för testerna (Worker-tsconfig saknar Node-typer). */
declare module "node:sqlite" {
  export class DatabaseSync {
    constructor(path: string);
    exec(sql: string): void;
    prepare(sql: string): {
      get(...params: unknown[]): unknown;
      all(...params: unknown[]): unknown[];
      run(...params: unknown[]): unknown;
    };
  }
}
