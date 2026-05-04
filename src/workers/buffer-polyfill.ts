import { Buffer } from "buffer";

if (!(self as { Buffer?: typeof Buffer }).Buffer) {
  (self as { Buffer?: typeof Buffer }).Buffer = Buffer;
}
