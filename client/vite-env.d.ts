/// <reference types="vite/client" />

declare module "xlsx-populate/browser/xlsx-populate" {
  type Cell = {
    value(): unknown;
    value(value: unknown): Cell;
    style(name: string | string[]): unknown;
    style(value: unknown): Cell;
  };

  type Column = {
    hidden(value: boolean): Column;
  };

  type Sheet = {
    name(): string;
    usedRange(): { value(): unknown[][] };
    cell(row: number, column: number): Cell;
    column(column: number): Column;
  };

  type Workbook = {
    sheet(index: number): Sheet;
    outputAsync(): Promise<Blob>;
  };

  const XlsxPopulate: {
    fromDataAsync(data: ArrayBuffer): Promise<Workbook>;
  };

  export default XlsxPopulate;
}
