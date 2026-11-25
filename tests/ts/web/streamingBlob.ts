/** jsdom's Blob has no stream(), which the codec's compression needs: a Blob over byte parts that streams them. */
export class StreamingBlob extends Blob {
  readonly chunks: Uint8Array<ArrayBuffer>[];
  constructor(parts: Uint8Array<ArrayBuffer>[]) {
    super(parts);
    this.chunks = parts;
  }
  override stream(): ReadableStream<Uint8Array<ArrayBuffer>> {
    const parts = this.chunks;
    return new ReadableStream({
      start(controller) {
        for (const part of parts) controller.enqueue(part);
        controller.close();
      },
    });
  }
}
