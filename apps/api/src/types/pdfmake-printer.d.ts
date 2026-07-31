/**
 * @types/pdfmake describes the *browser* entry point (`createPdf`), not the
 * server-side printer, and already does `declare module 'pdfmake'`. We import
 * the printer by its real resolved path so this declaration sits alongside the
 * shipped types rather than colliding with them.
 *
 * Note pdfmake 0.3.x dropped this server API entirely — the dependency is
 * pinned to ^0.2.20 for that reason.
 */
declare module 'pdfmake/src/printer' {
  import type { TDocumentDefinitions, TFontDictionary } from 'pdfmake/interfaces';

  /** Minimal surface of the pdfkit document pdfmake hands back. */
  interface PdfKitDocument {
    pipe<T extends NodeJS.WritableStream>(destination: T): T;
    on(event: 'error', listener: (err: Error) => void): this;
    end(): void;
  }

  class PdfPrinter {
    constructor(fonts: TFontDictionary);
    createPdfKitDocument(
      docDefinition: TDocumentDefinitions,
      options?: Record<string, unknown>,
    ): PdfKitDocument;
  }

  export = PdfPrinter;
}
